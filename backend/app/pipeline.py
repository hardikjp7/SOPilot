"""Live pipeline orchestration with request-local provenance for each stage."""
import time
from uuid import uuid4

from .audit import now
from .generate import generate_checklist
from .llm import capture_calls
from .parser import parse_alert
from .retrieval import Retriever
from .schemas import RunResponse, Timings
from .verify import verify_checklist


async def run_pipeline(alert, settings, llm):
    stages, timings = [], {}
    started = time.perf_counter()

    async def stage(name, before, operation, details):
        tick = time.perf_counter()
        ts = now()
        with capture_calls() as calls:
            result = await operation()
        timings[name] = (time.perf_counter() - tick) * 1000
        successful = [c for c in calls if c['ok']]
        stages.append({'stage': name, 'before': before, 'after': result.model_dump(),
                       'model': successful[-1]['model'] if successful else None, 'ts': ts,
                       'details': {**details(result), 'completed_at': now(), 'calls': calls}})
        return result

    parsed = await stage('parse', alert, lambda: parse_alert(alert, settings, llm=llm), lambda r: {})
    retrieval = await stage('retrieve', parsed.model_dump(), lambda: Retriever(settings, llm).retrieve(parsed),
                            lambda r: {'chunk_ids': [c.step_id for c in r.chunks],
                                       'retrieval_confidence': r.retrieval_confidence, 'margin': r.margin})
    draft = await stage('generate', {'parsed': parsed.model_dump(), 'retrieval': retrieval.model_dump()},
                        lambda: generate_checklist(parsed, retrieval, settings, llm=llm),
                        lambda r: {'skipped': r.status == 'no_matching_sop'})
    report = await stage('verify', draft.model_dump(), lambda: verify_checklist(draft, settings, llm=llm),
                         lambda r: {'verdicts': [v.model_dump() for v in r.verdicts], 'dropped_ids': r.dropped_ids})
    # Hash the public verified checklist as the stage output; verdicts stay in details.
    stages[-1]['after'] = report.checklist.model_dump()
    timings['total'] = (time.perf_counter() - started) * 1000
    run = RunResponse(run_id='RUN-' + uuid4().hex[:12], parsed=parsed, checklist=report.checklist,
                      timings_ms=Timings(**timings))
    return run, stages
