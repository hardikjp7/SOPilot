import json
from pathlib import Path
import shutil
import zipfile

import httpx
from jsonschema import Draft202012Validator
import pytest

from backend.app import schemas
from backend.app.audit import Store
from backend.app.config import ROOT
from backend.app.ticket import draft_from_run, export_markdown
from scripts.bundle_utils import GOLDEN_NAMES, SCHEMA_NAMES, contract_version, ensure_changelog, scan_secrets, synthetic_content, validate_goldens
from scripts.export_golden import capture,publish
from scripts.package_bundle import package

@pytest.fixture
def responses(tmp_path,catalog):
    content={'health.json':{'status':'ok','mock':False,'index_chunks':65},
             'samples.json':[s.model_dump() for s in catalog.samples]}
    for name in ('phishing','ransomware','credential_stuffing','public_s3_bucket','ambiguous','unknown'):
        raw=json.loads((ROOT/'data/alerts'/f'{name}.json').read_text())
        content[f'run-{name}.json']=catalog.runs[raw['alert_id']].model_dump()
    run=catalog.runs['ALR-PHI']
    store=Store(tmp_path/'fixture.db');store.save_run(run,{'alert_id':run.parsed.alert_id})
    draft=store.save_ticket(draft_from_run(catalog.ticket,run))
    approved=store.approve(draft.ticket_id,'Demo Analyst')
    content['ticket-draft.json']=draft.model_dump();content['ticket-approved.json']=approved.model_dump()
    content['audit.json']=[r.model_dump() for r in store.audit_rows(run.run_id)]
    return {name:(json.dumps(value,indent=2)+'\n').encode() for name,value in content.items()} | {'ticket-export.md':export_markdown(approved).encode()}

@pytest.fixture
def bundle_root(tmp_path,responses):
    root=tmp_path/'repo'
    (root/'docs/schemas').mkdir(parents=True)
    shutil.copy(ROOT/'docs/spec.md',root/'docs/spec.md')
    shutil.copy(ROOT/'docs/CHANGELOG-contract.md',root/'docs/CHANGELOG-contract.md')
    shutil.copytree(ROOT/'data/alerts',root/'data/alerts')
    schemas.export_schemas(root/'docs/schemas')
    publish(responses,root/'golden')
    return root


def test_schema_exports_include_open_audit_details(tmp_path):
    schemas.export_schemas(tmp_path)
    assert {p.stem for p in tmp_path.glob('*.json')}==set(SCHEMA_NAMES)
    for name in SCHEMA_NAMES:
        exported=json.loads((tmp_path/f'{name}.json').read_text())
        assert exported==getattr(schemas,name).model_json_schema()
        Draft202012Validator.check_schema(exported)
    assert json.loads((tmp_path/'AuditRow.json').read_text())['properties']['details_json']['additionalProperties'] is True


def test_validate_full_golden_set(responses):
    runs=validate_goldens(responses)
    assert len(runs)==6
    for name in SCHEMA_NAMES:
        model=getattr(schemas,name)
        if name=='RunResponse':
            for key,value in responses.items():
                if key.startswith('run-'):Draft202012Validator(model.model_json_schema()).validate(json.loads(value))
        if name=='AuditRow':
            for row in json.loads(responses['audit.json']):Draft202012Validator(model.model_json_schema()).validate(row)


def test_exporter_uses_six_seed_alerts_and_real_mode(responses):
    calls=[]
    by_id={json.loads(value)['parsed']['alert_id']:value for name,value in responses.items() if name.startswith('run-')}
    def handler(request):
        calls.append(request)
        path=request.url.path
        if path=='/api/run':
            alert=json.loads(request.content)['alert']
            assert alert['synthetic'] is True
            return httpx.Response(200,content=by_id[alert['alert_id']])
        names={'/api/health':'health.json','/api/samples':'samples.json','/api/ticket':'ticket-draft.json','/api/approve':'ticket-approved.json','/api/audit':'audit.json'}
        if path.endswith('/export.md'):
            return httpx.Response(200,content=responses['ticket-export.md'],headers={'content-type':'text/markdown'})
        if path=='/api/approve': assert json.loads(request.content)['analyst_name']=='Demo Analyst'
        return httpx.Response(200,content=responses[names[path]])
    with httpx.Client(base_url='http://localhost',transport=httpx.MockTransport(handler)) as client:
        blobs=capture(client)
    assert set(blobs)==set(GOLDEN_NAMES) and sum(r.url.path=='/api/run' for r in calls)==6
    def mock_backend(request):return httpx.Response(200,json={'status':'ok','mock':True,'index_chunks':0})
    with httpx.Client(base_url='http://localhost',transport=httpx.MockTransport(mock_backend)) as client:
        with pytest.raises(ValueError,match='MOCK=0'):capture(client)


def test_package_version_allowlist_and_no_secrets(bundle_root,monkeypatch):
    root=bundle_root
    monkeypatch.setenv('LLM_KEY','synthetic-canary-credential-for-export-test')
    (root/'.env').write_text('LLM_KEY=synthetic-canary-credential-for-export-test')
    (root/'data/chroma').mkdir();(root/'data/chroma/private.bin').write_bytes(b'private index')
    (root/'golden/.env').write_text('synthetic-canary-credential-for-export-test')
    path=package(root)
    assert path.name==f'contract-bundle-v{contract_version(root)}.zip'
    with zipfile.ZipFile(path) as archive:
        assert len(archive.namelist())==19
        assert not any('.env' in name or 'chroma' in name for name in archive.namelist())
        assert all(b'synthetic-canary-credential-for-export-test' not in archive.read(name) for name in archive.namelist())
    text=(root/'docs/spec.md').read_text().replace('Contract version: v2','Contract version: v7.2')
    (root/'docs/spec.md').write_text(text)
    assert package(root).name=='contract-bundle-v7.2.zip'


@pytest.mark.parametrize('bad', ['mock','missing','approval','hash','real_ip','real_domain'])
def test_rejects_invalid_goldens(responses,bad):
    blobs=responses.copy()
    if bad=='missing':blobs.pop('audit.json')
    elif bad=='mock':blobs['health.json']=b'{"status":"ok","mock":true,"index_chunks":0}'
    elif bad=='approval':
        value=json.loads(blobs['ticket-approved.json']);value['approved_by']='Other';blobs['ticket-approved.json']=json.dumps(value).encode()
    elif bad=='hash':
        value=json.loads(blobs['audit.json']);value[-1]['output_hash']='0'*64;blobs['audit.json']=json.dumps(value).encode()
    elif bad=='real_ip':blobs['ticket-export.md']+=b'\n127.0.0.1'
    elif bad=='real_domain':blobs['ticket-export.md']+=b'\nhttps://not-example.com/'
    with pytest.raises(ValueError):validate_goldens(blobs)


def test_secret_and_symlink_inputs_fail_closed(bundle_root,monkeypatch):
    monkeypatch.setenv('LLM_KEY','synthetic-canary-do-not-export')
    with pytest.raises(ValueError,match='Credential'):scan_secrets(b'synthetic-canary-do-not-export')
    path=bundle_root/'golden/health.json'
    original=path.read_bytes();path.unlink()
    other=bundle_root/'health-real.json';other.write_bytes(original)
    path.symlink_to(other)
    with pytest.raises(ValueError,match='symlink'):package(bundle_root)


def test_stale_schema_rejected_and_changelog_bootstrapped(bundle_root):
    root=bundle_root
    (root/'docs/CHANGELOG-contract.md').unlink()
    ensure_changelog(root)
    assert (root/'docs/CHANGELOG-contract.md').read_text().startswith('v1:')
    (root/'docs/schemas/AuditRow.json').write_text('{}')
    with pytest.raises(ValueError,match='stale'):package(root)
