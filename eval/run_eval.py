"""Paired live evaluation: python eval/run_eval.py (requires configured gateway/index)."""
import argparse
import asyncio
from collections import Counter
from datetime import datetime, timezone
import json
import math
from pathlib import Path
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.app.config import Settings
from backend.app.generate import generate_checklist
from backend.app.ingest import COLLECTION_NAME, open_chroma
from backend.app.llm import LLMClient, capture_calls
from backend.app.parser import parse_alert
from backend.app.retrieval import Retriever
from backend.app.schemas import Citation, EvalCase
from backend.app.verify import verify_checklist

CATEGORIES = {'clean':5, 'reworded':2, 'ambiguous':1, 'no_match':2, 'injection':1, 'missing_fields':1}
MODES = ('without_verifier', 'with_verifier')


def load_cases(path: Path) -> list[EvalCase]:
    cases = [EvalCase.model_validate(item) for item in json.loads(path.read_text(encoding='utf-8'))]
    if len({case.case_id for case in cases}) != len(cases):
        raise ValueError('Duplicate evaluation case IDs')
    if Counter(case.category for case in cases) != Counter(CATEGORIES):
        raise ValueError('Expected 12 cases: 5 clean, 2 reworded, 1 ambiguous, 2 no_match, 1 injection, 1 missing_fields')
    return cases


def percentile(values, quantile):
    if not values:
        return None
    values = sorted(values)
    position = (len(values) - 1) * quantile
    low, high = math.floor(position), math.ceil(position)
    return values[low] + (values[high] - values[low]) * (position - low)


def citation_valid(step, checklist, index, retrieved_ids):
    citation = step.citation
    return (citation.playbook_id == checklist.playbook_id and index.get(citation.step_id) == citation
            and citation.step_id in retrieved_ids)


def measure(case, checklist, elapsed, index, retrieved_ids, unsupported_ids):
    steps = checklist.steps
    valid = sum(citation_valid(s, checklist, index, retrieved_ids) for s in steps)
    # no_matching_sop is a retrieval fallback; low_confidence in a raw draft means
    # pending verification and is not itself a completed verifier fallback.
    expected_fallback = case.expected_status != 'grounded'
    prediction = None if checklist.status == 'no_matching_sop' else checklist.playbook_id
    return {
        'status': checklist.status, 'playbook_id': prediction,
        'playbook_match': prediction == case.expected_playbook,
        'expected_fallback': expected_fallback,
        'correct_fallback': checklist.status == case.expected_status if expected_fallback else None,
        'step_count': len(steps), 'valid_citations': valid, 'invalid_citations': len(steps) - valid,
        'unsupported_steps': sum(s.citation.step_id in unsupported_ids or not citation_valid(s, checklist, index, retrieved_ids) for s in steps),
        'latency_ms': elapsed, 'checklist': checklist.model_dump(),
    }


async def evaluate_case(case, settings, llm, index):
    started = time.perf_counter()
    with capture_calls() as calls:
        parsed = await parse_alert(case.alert, settings, llm=llm)
        retrieval = await Retriever(settings, llm).retrieve(parsed)
        draft = await generate_checklist(parsed, retrieval, settings, llm=llm)
        prefix_ms = (time.perf_counter() - started) * 1000
        report = await verify_checklist(draft, settings, llm=llm)
        verified_ms = (time.perf_counter() - started) * 1000
    unsupported_orders = {v.order for v in report.verdicts if v.support == 'unsupported'}
    unsupported_ids = {s.citation.step_id for s in draft.steps if s.order in unsupported_orders}
    retrieved_ids = {c.step_id for c in retrieval.chunks}
    return {
        'case_id': case.case_id, 'category': case.category,
        'expected_playbook': case.expected_playbook, 'expected_status': case.expected_status,
        'parsed': parsed.model_dump(), 'retrieved_chunk_ids': sorted(retrieved_ids),
        'retrieval_confidence': retrieval.retrieval_confidence, 'retrieval_margin': retrieval.margin,
        'verdicts': [v.model_dump() for v in report.verdicts], 'dropped_ids': report.dropped_ids,
        'calls': calls,
        'without_verifier': measure(case, draft, prefix_ms, index, retrieved_ids, unsupported_ids),
        'with_verifier': measure(case, report.checklist, verified_ms, index, retrieved_ids, unsupported_ids),
    }


def aggregate(results, mode):
    rows = [r[mode] for r in results if mode in r]
    steps = sum(r['step_count'] for r in rows)
    valid = sum(r['valid_citations'] for r in rows)
    fallback_total = sum(r['expected_status'] != 'grounded' for r in results)
    return {
        'cases_total': len(results), 'cases_completed': len(rows), 'cases_failed': len(results) - len(rows),
        'playbook_match_accuracy': sum(r['playbook_match'] for r in rows) / len(results) if results else None,
        'citation_validity_rate': valid / steps if steps else None,
        'valid_citations': valid, 'steps': steps,
        'unsupported_step_rate': sum(r['unsupported_steps'] for r in rows) / steps if steps else None,
        'unsupported_steps': sum(r['unsupported_steps'] for r in rows),
        'correct_fallback_rate': sum(r['correct_fallback'] is True for r in rows) / fallback_total if fallback_total else None,
        'expected_fallback_cases': fallback_total,
        'latency_p50_ms': percentile([r['latency_ms'] for r in rows], 0.50),
        'latency_p95_ms': percentile([r['latency_ms'] for r in rows], 0.95),
    }


def exit_code(metrics):
    if any(m['steps'] and m['valid_citations'] < m['steps'] for m in metrics.values()):
        return 1
    if any(m['cases_failed'] or not m['steps'] for m in metrics.values()):
        return 2
    return 0


def render_report(output):
    def percent(value):
        return 'N/A (no steps/cases)' if value is None else f'{value:.2%}'
    lines = ['# SOPilot paired pipeline evaluation', '', f"Generated: {output['generated_at']}", '',
             'Live parse → retrieve → generate runs once per case. Both branches share that exact draft; '
             'the with-verifier branch additionally applies deterministic and MODEL_FAST support verification.', '',
             'Unsupported-step labels are the production verifier’s model judgments, not independent human ground truth. '
             'The post-verifier unsupported rate is therefore a consistency measure. Partial support is kept and is not counted as unsupported.', '',
             'Latency excludes report writing and index initialization. Without-verifier latency ends at generation; '
             'with-verifier latency includes verification. Percentiles use linear interpolation over completed cases. '
             'Raw draft low_confidence means pending verification. No steps yields N/A citation/support rates, never an automatic 100%.', '',
             '| Metric | Without verifier | With verifier |', '|---|---:|---:|']
    metrics = output['metrics']
    for key, label in [('playbook_match_accuracy','Playbook match accuracy'), ('citation_validity_rate','Citation validity'),
                       ('unsupported_step_rate','Unsupported-step rate'), ('correct_fallback_rate','Correct fallback rate')]:
        lines.append(f"| {label} | {percent(metrics[MODES[0]][key])} | {percent(metrics[MODES[1]][key])} |")
    for key, label in [('latency_p50_ms','p50 latency (ms)'), ('latency_p95_ms','p95 latency (ms)'),
                       ('steps','Returned steps'), ('cases_completed','Completed cases'), ('cases_failed','Failed cases')]:
        values = [metrics[m][key] for m in MODES]
        lines.append('| ' + label + ' | ' + ' | '.join('N/A' if v is None else f'{v:.2f}' if isinstance(v,float) else str(v) for v in values) + ' |')
    lines.extend(['', 'Playbook accuracy includes expected null playbooks for no-match cases; failures count as misses. '
                  'Fallback rate is measured only over cases expecting a fallback; failures count as misses. '
                  'Citations require an indexed step ID, chosen-playbook membership, exact source text, and membership in the retrieved input.', '',
                  '| Case | Category | Expected | Without verifier | With verifier |', '|---|---|---|---|---|'])
    for row in output['results']:
        values = [row.get(mode, {}).get('status', 'ERROR: ' + row.get('error', 'unknown')) for mode in MODES]
        lines.append(f"| {row['case_id']} | {row['category']} | {row['expected_playbook'] or row['expected_status']} | {values[0]} | {values[1]} |")
    lines.extend(['', f"Exit code: {output['exit_code']} (1 = invalid citations; 2 = failures or no citation evidence).", ''])
    return '\n'.join(lines)


async def run_evaluation(cases, settings):
    if settings.mock:
        raise ValueError('Evaluation requires MOCK=0; canned fixtures cannot measure pipeline quality')
    collection = open_chroma(settings).get_collection(COLLECTION_NAME, embedding_function=None)
    rows = collection.get(where={'kind':'playbook'}, include=['documents','metadatas'])
    index = {identifier: Citation(playbook_id=meta['playbook_id'], step_id=identifier, source_text=text)
             for identifier, text, meta in zip(rows['ids'], rows['documents'], rows['metadatas'])}
    client = LLMClient(settings)
    results = []
    try:
        for case in cases:
            try:
                row = await evaluate_case(case, settings, client, index)
            except Exception as exc:
                # Class/code only: upstream messages may contain bodies or credentials.
                row = {'case_id':case.case_id, 'category':case.category, 'expected_playbook':case.expected_playbook,
                       'expected_status':case.expected_status, 'error':getattr(exc,'code',type(exc).__name__)}
            results.append(row)
            print(f"{case.case_id}: {row.get('with_verifier',{}).get('status', row.get('error'))}", flush=True)
    finally:
        await client.close()
    return results


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cases', type=Path, default=ROOT/'data/eval/cases.json')
    parser.add_argument('--output-dir', type=Path, default=ROOT/'eval')
    args = parser.parse_args(argv)
    cases = load_cases(args.cases)
    settings = Settings()
    try:
        results = asyncio.run(run_evaluation(cases, settings))
    except Exception as exc:
        results = [{'case_id':c.case_id, 'category':c.category, 'expected_playbook':c.expected_playbook,
                    'expected_status':c.expected_status, 'error':getattr(exc,'code',type(exc).__name__)} for c in cases]
    metrics = {mode: aggregate(results, mode) for mode in MODES}
    output = {'generated_at':datetime.now(timezone.utc).isoformat(), 'comparison':'paired_shared_draft',
              'support_judge':'production MODEL_FAST verifier (not independent ground truth)',
              'settings':{key:getattr(settings,key) for key in ['model_main','model_fast','model_fallback','model_embed',
                         'retrieval_top_k','retrieval_min_score','retrieval_min_margin','hybrid_weight_semantic','min_verified_steps']},
              'metrics':metrics, 'results':results, 'exit_code':exit_code(metrics)}
    args.output_dir.mkdir(parents=True,exist_ok=True)
    (args.output_dir/'results.json').write_text(json.dumps(output,indent=2,allow_nan=False)+'\n',encoding='utf-8')
    (args.output_dir/'report.md').write_text(render_report(output),encoding='utf-8')
    print(f"Wrote {args.output_dir/'report.md'} and {args.output_dir/'results.json'}; exit {output['exit_code']}")
    return output['exit_code']

if __name__ == '__main__':
    raise SystemExit(main())
