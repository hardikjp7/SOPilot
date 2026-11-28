import asyncio
import json
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from backend.app import main
from backend.app.audit import AlreadyApproved, Store, digest
from backend.app.config import Settings
from backend.app.llm import LLMClient
from backend.app.schemas import TicketContent
from backend.app.ticket import draft_from_run, generate_ticket, ticket_payload, validate_content, export_markdown

@pytest.fixture
def saved(tmp_path,catalog):
    store=Store(tmp_path/'app.db')
    run=catalog.runs['ALR-RAN'].model_copy(deep=True)
    store.save_run(run,{'alert_id':run.parsed.alert_id})
    draft=draft_from_run(catalog.ticket,run)
    return store,run,draft


def test_draft_approval_audit_and_immutability(saved):
    store,run,draft=saved
    ticket=store.save_ticket(draft,model='test-main')
    assert ticket.status=='draft' and ticket.approved_by is None
    assert store.save_ticket(draft)==ticket
    approved=store.approve(ticket.ticket_id,' Analyst ')
    assert approved.approved_by=='Analyst' and approved.approved_at and approved.status=='approved'
    assert all(a.status=='approved' for a in approved.containment_actions)
    with pytest.raises(AlreadyApproved): store.approve(ticket.ticket_id,'Another')
    with pytest.raises(AlreadyApproved): store.save_ticket(draft)
    rows=store.audit_rows(run.run_id)
    assert [r.stage for r in rows]==['parse','retrieve','generate','verify','ticket','approve']
    assert rows[-2].model=='test-main' and rows[-1].model is None
    assert rows[-2].output_hash==digest(ticket.model_dump())
    assert rows[-1].output_hash==digest(approved.model_dump())
    assert rows[-1].details_json['analyst_name']=='Analyst'
    with sqlite3.connect(store.path) as db:
        for sql,args in [
            ('UPDATE tickets SET status=? WHERE ticket_id=?',('draft',ticket.ticket_id)),
            ('DELETE FROM tickets WHERE ticket_id=?',(ticket.ticket_id,)),
            ('INSERT OR REPLACE INTO tickets VALUES (?,?,?,?,?,?)',(ticket.ticket_id,run.run_id,'draft',ticket.model_dump_json(),None,None)),
            ('INSERT OR REPLACE INTO tickets VALUES (?,?,?,?,?,?)',('INC-20261118-999',run.run_id,'draft',ticket.model_dump_json(),None,None)),
            ('DELETE FROM audit WHERE run_id=?',(run.run_id,)),
            ('UPDATE audit SET model=? WHERE run_id=?',('changed',run.run_id)),
        ]:
            with pytest.raises(sqlite3.IntegrityError): db.execute(sql,args)
    assert store.get_ticket(ticket.ticket_id)==approved


def test_concurrent_approvals_have_one_winner(saved):
    store,run,draft=saved
    ticket=store.save_ticket(draft)
    def approve(name):
        try: return store.approve(ticket.ticket_id,name).approved_by
        except AlreadyApproved: return None
    with ThreadPoolExecutor(max_workers=2) as pool:
        results=list(pool.map(approve,['A','B']))
    assert sum(r is not None for r in results)==1
    assert len([r for r in store.audit_rows(run.run_id) if r.stage=='approve'])==1


def test_concurrent_drafts_share_ticket_and_single_audit_row(saved):
    store,run,draft=saved
    with ThreadPoolExecutor(max_workers=2) as pool:
        tickets=list(pool.map(lambda _: store.save_ticket(draft), range(2)))
    assert tickets[0] == tickets[1]
    assert len([r for r in store.audit_rows(run.run_id) if r.stage=='ticket'])==1


def test_audit_replace_is_blocked_and_invalid_stage_set_rolls_back(tmp_path,catalog,saved):
    store,run,_=saved
    row=store.audit_rows(run.run_id)[0]
    with sqlite3.connect(store.path) as db:
        with pytest.raises(sqlite3.IntegrityError,match='append-only'):
            db.execute('INSERT OR REPLACE INTO audit VALUES (?,?,?,?,?,?,?,?)',
                       (row.id,row.run_id,row.stage,row.ts,'changed',row.input_hash,row.output_hash,'{}'))
    other=Store(tmp_path/'other.db')
    with pytest.raises(ValueError): other.save_run(run,{},stages=[])
    with sqlite3.connect(other.path) as db:
        assert db.execute('SELECT COUNT(*) FROM runs').fetchone()[0]==0
        assert db.execute('SELECT COUNT(*) FROM audit').fetchone()[0]==0


def test_blank_analyst_and_preapproved_ticket_rejected(saved):
    store,run,draft=saved
    with pytest.raises(ValueError): store.approve('missing',' ')
    draft.status='approved'
    with pytest.raises(ValueError): store.save_ticket(draft)


def test_no_match_ticket_keeps_escalation_and_no_actions(tmp_path,catalog):
    run=catalog.runs['ALR-NOMATCH']
    draft=draft_from_run(catalog.ticket,run)
    store=Store(tmp_path/'app.db');store.save_run(run,{})
    ticket=store.save_ticket(draft)
    assert ticket.containment_actions==[]
    assert run.checklist.escalation_note in [e.event for e in ticket.timeline]


@pytest.mark.parametrize('mutation', ['action','timeline','asset','cve','basis','confidence','hypothesis'])
def test_content_grounding_rejects_inventions(saved,mutation):
    _,run,draft=saved
    data={k:draft.model_dump()[k] for k in TicketContent.model_fields}
    if mutation=='action': data['containment_actions'][0]['action']='Delete all evidence.'
    if mutation=='timeline': data['timeline'].append({'time':None,'event':'Confirmed exfiltration.'})
    if mutation=='asset': data['affected_assets']=['invented.example.org']
    if mutation=='cve': data['cves']=['CVE-2099-999999']
    if mutation=='basis': data['root_cause']['basis']=['Invented basis']
    if mutation=='confidence': data['root_cause']['confidence']=1.0
    if mutation=='hypothesis': data['root_cause']['hypothesis']='Confirmed ransomware cause.'
    with pytest.raises(ValueError): validate_content(TicketContent.model_validate(data),ticket_payload(run,[]))


def test_strict_model_ticket_output_and_export(saved,tmp_path):
    _,run,draft=saved
    content=TicketContent.model_validate({k:draft.model_dump()[k] for k in TicketContent.model_fields})
    response=SimpleNamespace(status='completed',output_text=content.model_dump_json(),usage=None)
    sdk=SimpleNamespace(responses=SimpleNamespace(create=AsyncMock(return_value=response)))
    settings=Settings(_env_file=None,mock=False,data_dir=tmp_path)
    ticket,payload=asyncio.run(generate_ticket(run,settings,llm=LLMClient(settings,client=sdk),events=[]))
    assert ticket.root_cause.hypothesis.startswith('Hypothesis:') and ticket.status=='draft'
    call=sdk.responses.create.call_args.kwargs
    assert call['model']==settings.model_main and call['text']['format']['strict']
    text=export_markdown(ticket)
    assert 'Root cause confidence' in text and 'Indicators' in text and 'PB-RAN-01' in text


def test_live_endpoint_flow_and_audit_provenance(tmp_path,catalog,monkeypatch):
    settings=Settings(_env_file=None,mock=False,llm_key=None,data_dir=tmp_path)
    parsed=catalog.runs['ALR-RAN'].parsed
    retrieval=SimpleNamespace(model_dump=lambda:{'chunks':[]},chunks=[],retrieval_confidence=0.9,margin=0.2)
    checklist=catalog.runs['ALR-RAN'].checklist
    from backend.app.schemas import VerificationResult
    report=VerificationResult(checklist=checklist,verdicts=[],dropped_ids=[])
    monkeypatch.setattr('backend.app.pipeline.parse_alert',AsyncMock(return_value=parsed))
    monkeypatch.setattr('backend.app.pipeline.Retriever.retrieve',AsyncMock(return_value=retrieval))
    monkeypatch.setattr('backend.app.pipeline.generate_checklist',AsyncMock(return_value=checklist))
    monkeypatch.setattr('backend.app.pipeline.verify_checklist',AsyncMock(return_value=report))
    content=TicketContent.model_validate({k:draft_from_run(catalog.ticket,catalog.runs['ALR-RAN']).model_dump()[k] for k in TicketContent.model_fields})
    with TestClient(main.create_app(settings)) as client:
        client.app.state.llm.complete=AsyncMock(return_value=content)
        run=client.post('/api/run',json={'alert':{'synthetic':True}}).json()
        response=client.post('/api/ticket',json={'run_id':run['run_id']})
        assert response.status_code==200
        ticket=response.json()
        assert client.post('/api/ticket',json={'run_id':run['run_id']}).json()==ticket
        client.app.state.llm.complete.assert_awaited_once()
        assert client.post('/api/approve',json={'ticket_id':ticket['ticket_id'],'analyst_name':'Analyst'}).status_code==200
        assert client.post('/api/approve',json={'ticket_id':ticket['ticket_id'],'analyst_name':'Analyst'}).status_code==409
        audit=client.get('/api/audit',params={'run_id':run['run_id']}).json()
        assert [r['stage'] for r in audit]==['parse','retrieve','generate','verify','ticket','approve']
        assert all(r['details_json']['alert_hash']==digest({'synthetic':True}) for r in audit)
        assert 'verdicts' in audit[3]['details_json']
        assert client.get(f"/api/tickets/{ticket['ticket_id']}/export.md").status_code==200
