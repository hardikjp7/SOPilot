import asyncio
from copy import deepcopy
import json
from pathlib import Path
from unittest.mock import AsyncMock

import pytest

from backend.app.config import ROOT
from backend.app.schemas import Citation, EvalCase, StepVerdict, VerificationResult
from eval import run_eval as evaluation


def test_suite_has_twelve_balanced_cases_and_missing_evidence_is_fallback():
    cases=evaluation.load_cases(ROOT/'data/eval/cases.json')
    assert len(cases)==12
    assert next(c for c in cases if c.category=='missing_fields').expected_playbook is None
    assert next(c for c in cases if c.category=='missing_fields').expected_status=='no_matching_sop'
    assert next(c for c in cases if c.case_id=='CASE-clean-ddos').expected_playbook=='PB-DOS'


def test_case_ids_and_category_counts_are_validated(tmp_path):
    path=tmp_path/'cases.json'
    cases=json.loads((ROOT/'data/eval/cases.json').read_text())
    cases[1]['case_id']=cases[0]['case_id'];path.write_text(json.dumps(cases))
    with pytest.raises(ValueError,match='Duplicate'):evaluation.load_cases(path)
    path.write_text('[]')
    with pytest.raises(ValueError,match='12 cases'):evaluation.load_cases(path)


def test_metric_counts_citations_and_unsupported_without_trusting_flags(catalog):
    checklist=catalog.runs['ALR-RAN'].checklist.model_copy(deep=True)
    index={s.citation.step_id:s.citation.model_copy(deep=True) for s in checklist.steps}
    ids=set(index)
    checklist.steps[0].citation.source_text='invented'
    case=EvalCase(case_id='case',category='clean',alert={},expected_playbook='PB-RAN',expected_status='grounded')
    row=evaluation.measure(case,checklist,10,index,ids,{'PB-RAN-02'})
    assert row['valid_citations']==2 and row['invalid_citations']==1
    assert row['unsupported_steps']==2  # Invalid source plus semantic unsupported.
    assert row['playbook_match']
    assert not evaluation.citation_valid(checklist.steps[2],checklist,index,set())


def test_denominators_failures_empty_rates_and_gate(catalog):
    checklist=catalog.runs['ALR-RAN'].checklist
    index={s.citation.step_id:s.citation for s in checklist.steps}
    case=EvalCase(case_id='case',category='clean',alert={},expected_playbook='PB-RAN',expected_status='grounded')
    row=evaluation.measure(case,checklist,20,index,set(index),set())
    results=[{'expected_status':'grounded','with_verifier':row}, {'expected_status':'no_matching_sop','error':'failure'}]
    metrics=evaluation.aggregate(results,'with_verifier')
    assert metrics['playbook_match_accuracy']==0.5 and metrics['correct_fallback_rate']==0
    assert metrics['cases_failed']==1 and metrics['citation_validity_rate']==1
    assert evaluation.exit_code({'with_verifier':metrics})==2
    metrics['valid_citations']=2
    assert evaluation.exit_code({'with_verifier':metrics})==1
    empty=evaluation.aggregate([{'expected_status':'grounded','error':'failure'}],'with_verifier')
    assert empty['citation_validity_rate'] is None and empty['unsupported_step_rate'] is None
    assert evaluation.exit_code({'with_verifier':empty})==2


def test_percentiles_are_linear():
    assert evaluation.percentile([],0.95) is None
    assert evaluation.percentile([5],0.95)==5
    assert evaluation.percentile([10,20,30,40],0.5)==25
    assert evaluation.percentile([10,20,30,40],0.95)==pytest.approx(38.5)


def test_paired_case_shares_draft_and_accounts_for_dropped_steps(catalog,settings,monkeypatch):
    run=catalog.runs['ALR-RAN'].model_copy(deep=True)
    draft=run.checklist
    verified=draft.model_copy(deep=True)
    verified.steps=verified.steps[:2]
    verified.status='low_confidence';verified.escalation_note='Review needed.'
    report=VerificationResult(checklist=verified,verdicts=[StepVerdict(order=i,support='unsupported' if i==3 else 'supported',reason='Evidence.') for i in [1,2,3]],dropped_ids=['PB-RAN-03'])
    retrieval=type('Retrieval',(),{'chunks':[type('Chunk',(),{'step_id':s.citation.step_id}) for s in draft.steps], 'retrieval_confidence':0.9,'margin':0.2})()
    parse=AsyncMock(return_value=run.parsed);generate=AsyncMock(return_value=draft);verify=AsyncMock(return_value=report)
    monkeypatch.setattr(evaluation,'parse_alert',parse)
    monkeypatch.setattr(evaluation.Retriever,'retrieve',AsyncMock(return_value=retrieval))
    monkeypatch.setattr(evaluation,'generate_checklist',generate)
    monkeypatch.setattr(evaluation,'verify_checklist',verify)
    case=EvalCase(case_id='case',category='clean',alert={},expected_playbook='PB-RAN',expected_status='grounded')
    index={s.citation.step_id:s.citation for s in draft.steps}
    result=asyncio.run(evaluation.evaluate_case(case,settings,object(),index))
    assert result['without_verifier']['unsupported_steps']==1
    assert result['with_verifier']['unsupported_steps']==0
    assert result['without_verifier']['step_count']==3 and result['with_verifier']['step_count']==2
    assert result['with_verifier']['latency_ms']>=result['without_verifier']['latency_ms']
    parse.assert_awaited_once();generate.assert_awaited_once();verify.assert_awaited_once()


def test_cli_writes_both_artifacts_and_nonzero_for_bad_citations(tmp_path,monkeypatch,catalog):
    cases=evaluation.load_cases(ROOT/'data/eval/cases.json')
    checklist=catalog.runs['ALR-RAN'].checklist
    index={s.citation.step_id:s.citation for s in checklist.steps}
    results=[]
    for case in cases:
        metric=evaluation.measure(case,checklist,10,index,set(),set())
        results.append({'case_id':case.case_id,'category':case.category,'expected_status':case.expected_status,
                        'expected_playbook':case.expected_playbook, **{mode:metric for mode in evaluation.MODES}})
    monkeypatch.setattr(evaluation,'run_evaluation',AsyncMock(return_value=results))
    assert evaluation.main(['--output-dir',str(tmp_path)])==1
    output=json.loads((tmp_path/'results.json').read_text())
    assert output['exit_code']==1
    text=(tmp_path/'report.md').read_text()
    assert 'p95 latency' in text and 'Unsupported-step rate' in text
    assert 'Without verifier' in text and 'With verifier' in text
    assert 'LLM_KEY' not in (tmp_path/'results.json').read_text()
