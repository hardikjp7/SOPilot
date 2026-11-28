import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from backend.app import main
from backend.app.config import Settings
from backend.app.ingest import COLLECTION_NAME, load_chunks, open_chroma
from backend.app.llm import LLMClient, LLMUnavailable
from backend.app.schemas import StepVerdict, SupportVerdicts
from backend.app.verify import verify_checklist

@pytest.fixture
def indexed(tmp_path, catalog):
    settings = Settings(_env_file=None, mock=False, llm_key=None, data_dir=tmp_path)
    chunks = load_chunks()
    collection = open_chroma(settings).create_collection(COLLECTION_NAME, embedding_function=None)
    collection.add(ids=[c.id for c in chunks], documents=[c.text for c in chunks],
                   metadatas=[c.metadata for c in chunks], embeddings=[[1.0, 0.0] for c in chunks])
    checklist = catalog.runs['ALR-RAN'].checklist.model_copy(deep=True)
    return settings, checklist


def judge(verdicts):
    return SimpleNamespace(complete=AsyncMock(return_value=SupportVerdicts(verdicts=[
        StepVerdict(order=i, support=support, reason='Evidence assessed against source.') for i, support in verdicts])))


def test_fake_id_and_mismatched_citation_are_dropped_and_counted(indexed):
    settings, checklist = indexed
    checklist.steps[0].citation.step_id = 'PB-RAN-99'
    checklist.steps[1].citation.step_id = 'PB-PHI-02'
    client = judge([(3, 'supported')])
    report = asyncio.run(verify_checklist(checklist, settings, llm=client))
    result = report.checklist
    assert result.dropped_count == 2 and len(result.steps) == 1
    assert result.steps[0].citation.step_id == 'PB-RAN-03'
    assert result.steps[0].order == 1 and result.steps[0].verified
    assert result.status == 'low_confidence'
    assert set(report.dropped_ids) == {'PB-RAN-99', 'PB-PHI-02'}
    payload = client.complete.call_args.kwargs['payload']
    assert [s['order'] for s in payload['steps']] == [3]
    client.complete.assert_awaited_once()


def test_unsupported_dropped_partial_flagged_and_input_unchanged(indexed):
    settings, checklist = indexed
    before = checklist.model_dump()
    client = judge([(3,'partial'), (1,'supported'), (2,'unsupported')])
    report = asyncio.run(verify_checklist(checklist, settings, llm=client))
    assert checklist.model_dump() == before
    assert report.checklist.dropped_count == 1
    assert [s.support for s in report.checklist.steps] == ['supported', 'partial']
    assert [s.order for s in report.checklist.steps] == [1,2]
    for step, original in zip(report.checklist.steps, [checklist.steps[0],checklist.steps[2]]):
        assert step.action == original.action and step.rationale == original.rationale
        assert step.citation == original.citation and step.verified
    assert report.verdicts[1].support == 'unsupported' and report.verdicts[1].reason


def test_three_kept_steps_grounded_and_threshold_configurable(indexed):
    settings, checklist = indexed
    client = judge([(1,'supported'),(2,'partial'),(3,'supported')])
    report = asyncio.run(verify_checklist(checklist, settings, llm=client))
    assert report.checklist.status == 'grounded' and report.checklist.escalation_note == ''
    settings.min_verified_steps = 4
    assert asyncio.run(verify_checklist(checklist,settings,llm=client)).checklist.status == 'low_confidence'


@pytest.mark.parametrize('orders', [[1,2], [1,2,3,4], [1,1,3]])
def test_model_cannot_add_or_omit_steps(indexed, orders):
    settings, checklist = indexed
    client = judge([(i,'supported') for i in orders])
    with pytest.raises(LLMUnavailable):
        asyncio.run(verify_checklist(checklist, settings, llm=client))


def test_all_invalid_skips_model_and_counts_existing_drops(indexed):
    settings, checklist = indexed
    checklist.dropped_count = 2
    for step in checklist.steps:
        step.citation.source_text = 'Altered source'
    client = judge([])
    report = asyncio.run(verify_checklist(checklist, settings, llm=client))
    assert report.checklist.dropped_count == 5 and report.checklist.steps == []
    assert report.checklist.status == 'low_confidence'
    client.complete.assert_not_awaited()


def test_no_match_empty_skips_index_and_model(tmp_path,catalog):
    settings = Settings(_env_file=None,mock=False,llm_key=None,data_dir=tmp_path)
    checklist = catalog.runs['ALR-NOMATCH'].checklist
    client = judge([])
    assert asyncio.run(verify_checklist(checklist,settings,llm=client)).checklist == checklist
    client.complete.assert_not_awaited()


def test_live_checklist_endpoint_verifies_before_return(indexed, catalog, monkeypatch):
    settings, checklist = indexed
    monkeypatch.setattr(main.Retriever, 'retrieve', AsyncMock(return_value=None))
    monkeypatch.setattr(main, 'generate_checklist', AsyncMock(return_value=checklist))
    client = judge([(1,'supported'), (2,'unsupported'), (3,'partial')])
    with TestClient(main.create_app(settings)) as session:
        session.app.state.llm.complete = client.complete
        response = session.post('/api/checklist', json={'parsed':catalog.runs['ALR-RAN'].parsed.model_dump()})
    assert response.status_code == 200
    assert response.json()['dropped_count'] == 1 and len(response.json()['steps']) == 2
    assert all(s['verified'] for s in response.json()['steps'])


def test_wrapper_fast_schema_and_verdict_validation(indexed, monkeypatch):
    settings, checklist = indexed
    monkeypatch.setattr('backend.app.llm.asyncio.sleep', AsyncMock())
    def response(orders):
        return SimpleNamespace(status='completed', output_text=SupportVerdicts(verdicts=[
            StepVerdict(order=i,support='supported',reason='Supported by source.') for i in orders]).model_dump_json(), usage=None)
    sdk = SimpleNamespace(responses=SimpleNamespace(create=AsyncMock(side_effect=[response([1,2,3,4]),response([1,2,3])])),close=AsyncMock())
    report = asyncio.run(verify_checklist(checklist,settings,llm=LLMClient(settings,client=sdk)))
    assert report.checklist.status == 'grounded'
    calls = sdk.responses.create.call_args_list
    assert len(calls) == 2 and all(c.kwargs['model'] == settings.model_fast for c in calls)
    assert calls[0].kwargs['text']['format']['strict'] is True
    assert 'Do not add' in calls[0].kwargs['instructions']


def test_missing_index_fails_closed(tmp_path,catalog):
    settings=Settings(_env_file=None,mock=False,data_dir=tmp_path)
    with pytest.raises(LLMUnavailable,match='index is missing'):
        asyncio.run(verify_checklist(catalog.runs['ALR-RAN'].checklist,settings,llm=judge([])))
