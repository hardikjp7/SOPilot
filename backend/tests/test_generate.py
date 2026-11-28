import asyncio
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from backend.app.config import Settings
from backend.app.generate import generate_checklist, generation_chunks
from backend.app.ingest import load_chunks
from backend.app.llm import LLMClient, LLMUnavailable
from backend.app.main import create_app
from backend.app.schemas import ChecklistDraft, GeneratedStep, RetrievedChunk, RetrievalResult

@pytest.fixture
def inputs(catalog):
    parsed = catalog.runs['ALR-RAN'].parsed.model_copy(deep=True)
    chunks = [RetrievedChunk(playbook_id=c.metadata['playbook_id'], step_id=c.id, text=c.text,
                            metadata=c.metadata, score=0.8, semantic_score=0.8, keyword_score=0.8)
              for c in load_chunks() if c.id.startswith('PB-RAN-')][:3]
    return parsed, RetrievalResult(chunks=chunks, retrieval_confidence=0.8, margin=0.3, meets_thresholds=True)

@pytest.mark.parametrize('reason', ['unknown','score','margin','empty'])
def test_fallback_no_llm(inputs, settings, reason):
    parsed, retrieval = inputs
    if reason == 'unknown': parsed.attack_type = 'unknown'
    elif reason == 'score': retrieval.retrieval_confidence = 0.1
    elif reason == 'margin': retrieval.margin = 0.01
    else: retrieval.chunks = []
    client = SimpleNamespace(generate_checklist=AsyncMock(side_effect=AssertionError('No model call')))
    result = asyncio.run(generate_checklist(parsed, retrieval, settings, llm=client))
    assert result.status == 'no_matching_sop' and not result.steps and result.escalation_note


def test_draft_citations_context_and_cves(inputs, settings):
    parsed, retrieval = inputs
    parsed.iocs.cve_ids = ['CVE-2099-900004','CVE-2099-999999']
    chunks = generation_chunks(parsed, retrieval)
    draft = ChecklistDraft(steps=[GeneratedStep(action=c['allowed_action'], rationale='Relevant evidence.',
                         playbook_id=c['playbook_id'], step_id=c['step_id']) for c in reversed(chunks)])
    client = SimpleNamespace(generate_checklist=AsyncMock(return_value=draft))
    result = asyncio.run(generate_checklist(parsed,retrieval,settings,llm=client))
    assert [s.order for s in result.steps] == [1,2,3]
    assert all(not s.verified for s in result.steps) and result.status == 'low_confidence'
    assert result.related_cves[0].id == 'CVE-2099-900004' and len(result.related_cves) == 1
    assert all(s.citation.source_text in [c.text for c in retrieval.chunks] for s in result.steps)

@pytest.mark.parametrize('bad', ['id','action','book','duplicate'])
def test_rejects_invented_or_unprovided_steps(inputs,settings,bad):
    parsed,retrieval=inputs
    c=generation_chunks(parsed,retrieval)[0]
    step=GeneratedStep(action=c['allowed_action'],rationale='Evidence.',playbook_id=c['playbook_id'],step_id=c['step_id'])
    if bad=='id': step.step_id='PB-RAN-99'
    if bad=='action': step.action += ' Delete all files.'
    if bad=='book': step.playbook_id='PB-PHI'
    draft=ChecklistDraft(steps=[step,step] if bad=='duplicate' else [step])
    with pytest.raises(LLMUnavailable):
        asyncio.run(generate_checklist(parsed,retrieval,settings,llm=SimpleNamespace(generate_checklist=AsyncMock(return_value=draft))))

class ToolItem(SimpleNamespace):
    def model_dump(self,**kwargs): return vars(self)

def test_tool_loop_uses_only_alert_cves_and_continues_with_output(inputs,tmp_path):
    parsed,retrieval=inputs
    parsed.iocs.cve_ids=['CVE-2099-900004']
    chunks=generation_chunks(parsed,retrieval)
    draft=ChecklistDraft(steps=[GeneratedStep(action=chunks[0]['allowed_action'],rationale='Evidence.',playbook_id='PB-RAN',step_id=chunks[0]['step_id'])])
    responses=[SimpleNamespace(status='completed',output=[ToolItem(type='function_call',name='lookup_cve',arguments='{"id":"CVE-2099-900004"}',call_id='call1')],usage=None),
               SimpleNamespace(status='completed',output=[],output_text=draft.model_dump_json(),usage=None)]
    sdk=SimpleNamespace(responses=SimpleNamespace(create=AsyncMock(side_effect=responses)))
    client=LLMClient(Settings(_env_file=None,mock=False,data_dir=tmp_path),client=sdk)
    result=asyncio.run(client.generate_checklist({'parsed':parsed.model_dump(),'chunks':chunks}))
    assert result==draft
    calls=sdk.responses.create.call_args_list
    assert calls[0].kwargs['model']==client.settings.model_main
    assert calls[0].kwargs['tools'][0]['name']=='lookup_cve'
    assert calls[0].kwargs['tool_choice']=='required' and calls[1].kwargs['tool_choice']=='none'
    outputs=[i for i in calls[1].kwargs['input'] if isinstance(i,dict) and i.get('type')=='function_call_output']
    assert json.loads(outputs[0]['output'])['remediation']
    assert len((tmp_path/'usage.jsonl').read_text().splitlines())==2


def test_endpoint_unknown_skips_retrieval(inputs,tmp_path):
    parsed,_=inputs
    parsed.attack_type='unknown'
    with TestClient(create_app(Settings(_env_file=None,mock=False,llm_key=None,data_dir=tmp_path))) as client:
        response=client.post('/api/checklist',json={'parsed':parsed.model_dump()})
        assert response.status_code==200 and response.json()['status']=='no_matching_sop'
