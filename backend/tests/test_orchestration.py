"""Full HTTP pipeline, real local Chroma, deterministic fake SDK responses."""
import asyncio
import hashlib
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from backend.app import main
from backend.app.config import ROOT, Settings
from backend.app.ingest import ingest
from backend.app.llm import LLMClient
from backend.app.retrieval import tokens
from backend.app.schemas import RunResponse

LABELS = {
    'ALR-PHI': ('phishing', 'high', 'Review reported message headers and URL in mail security console. Quarantine the reported message.'),
    'ALR-RAN': ('ransomware', 'critical', 'Confirm encryption activity on reported host EDR console. Isolate affected host from network via EDR.'),
    'ALR-CRD': ('credential_stuffing', 'high', 'Confirm the failed login burst in authentication logs. Apply the approved temporary rate limit to the affected login endpoint.'),
    'ALR-S3': ('public_s3_bucket', 'high', 'Confirm public access on reported bucket in cloud console. Enable Block Public Access on reported bucket after owner confirmation.'),
    'ALR-AMBIGUOUS': ('unknown', 'medium', 'An unconfirmed report lacks evidence. Further review is required.'),
    'ALR-NOMATCH': ('unknown', 'low', 'An environmental temperature sensor reports a fan warning. Facilities review is required.'),
}


def vector(text):
    result = [0.0] * 1024
    for token in tokens(text):
        result[int.from_bytes(hashlib.sha256(token.encode()).digest()[:4], 'big') % len(result)] += 1
    return result


class Item(SimpleNamespace):
    def model_dump(self, **kwargs):
        return vars(self)


class PipelineSDK:
    def __init__(self):
        self.responses = SimpleNamespace(create=self.respond)
        self.embeddings = SimpleNamespace(create=self.embed)
        self.close = AsyncMock()
        self.calls = []

    async def embed(self, **request):
        return SimpleNamespace(data=[SimpleNamespace(index=i, embedding=vector(text)) for i, text in enumerate(request['input'])], usage=None)

    async def respond(self, **request):
        schema = request['text']['format']['name']
        self.calls.append(schema)
        payload = json.loads(request['input'][0]['content'])
        if schema == 'AlertClassification':
            attack, severity, summary = LABELS[payload['alert']['alert_id']]
            output = dict(attack_type=attack, severity=severity, summary=summary, confidence=0.95,
                          evidence_fields=['$.source'] if '$.source' in payload['evidence_paths'] else ['$.message'])
        elif schema == 'ChecklistDraft':
            completed = {json.loads(item['output']).get('id') for item in request['input']
                         if isinstance(item, dict) and item.get('type') == 'function_call_output'}
            remaining = [identifier for identifier in payload['parsed']['iocs']['cve_ids'] if identifier not in completed]
            if remaining:
                return SimpleNamespace(status='completed', output=[Item(type='function_call', name='lookup_cve',
                    arguments=json.dumps({'id': identifier}), call_id=identifier) for identifier in remaining], usage=None)
            output = {'steps': [{'playbook_id': c['playbook_id'], 'step_id': c['step_id'],
                                 'action': c['allowed_action'], 'rationale': 'Synthetic evidence supports review.'}
                                for c in payload['chunks'][:3]]}
        elif schema == 'SupportVerdicts':
            output = {'verdicts': [{'order': s['order'], 'support': 'supported', 'reason': 'Action follows the cited source.'}
                                   for s in payload['steps']]}
        else:
            raise AssertionError(schema)
        return SimpleNamespace(status='completed', output=[], output_text=json.dumps(output), usage=None)


@pytest.mark.parametrize('filename', ['phishing', 'ransomware', 'credential_stuffing', 'public_s3_bucket', 'ambiguous', 'unknown'])
def test_six_raw_alerts_full_live_mode_pipeline(tmp_path, monkeypatch, filename):
    # The token-hash test embedder is not calibrated like the live embedding model.
    # Use a test-specific score cutoff to exercise generation/verification for all
    # four known classes; production threshold behavior has separate retrieval tests.
    settings = Settings(_env_file=None, mock=False, data_dir=tmp_path, model_embed='offline-test', retrieval_min_score=0.3)
    sdk = PipelineSDK()
    async def build():
        await ingest(settings, llm=LLMClient(settings, client=sdk))
    asyncio.run(build())
    monkeypatch.setattr(main, 'LLMClient', lambda s: LLMClient(s, client=sdk))
    raw = json.loads((ROOT / 'data/alerts' / f'{filename}.json').read_text())
    with TestClient(main.create_app(settings)) as client:
        response = client.post('/api/run', json={'alert': raw})
        assert response.status_code == 200, response.text
        run = RunResponse.model_validate(response.json())
        assert run.parsed.attack_type == LABELS[raw['alert_id']][0]
        assert run.parsed.alert_id == run.checklist.alert_id == raw['alert_id']
        timings = run.timings_ms.model_dump()
        assert set(timings) == {'parse', 'retrieve', 'generate', 'verify', 'total'}
        assert all(value >= 0 for value in timings.values())
        assert timings['total'] >= sum(v for k, v in timings.items() if k != 'total')
        assert client.app.state.store.get_run(run.run_id) == run
        audit = client.get('/api/audit', params={'run_id': run.run_id}).json()
        assert [r['stage'] for r in audit] == ['parse', 'retrieve', 'generate', 'verify']
        assert sdk.calls[0] == 'AlertClassification'
        if run.parsed.attack_type == 'unknown':
            assert run.checklist.status == 'no_matching_sop' and not run.checklist.steps
            assert 'ChecklistDraft' not in sdk.calls and 'SupportVerdicts' not in sdk.calls
        else:
            assert run.checklist.status == 'grounded'
            assert len(run.checklist.steps) == 3 and all(s.verified for s in run.checklist.steps)
            assert 'ChecklistDraft' in sdk.calls and 'SupportVerdicts' in sdk.calls


@pytest.mark.parametrize('content_type', [None, 'text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data'])
def test_requires_json_media_type(client, content_type):
    response = client.post('/api/run', content='{"alert":{}}', headers={'Content-Type': content_type} if content_type else {})
    assert response.status_code == 422 and response.json()['error']['code'] == 'validation_error'


@pytest.mark.parametrize('content_type', ['application/json; charset=utf-8', 'application/problem+json', 'APPLICATION/JSON'])
def test_json_media_type_variants(client, content_type):
    assert client.post('/api/run', content='{"alert":{}}', headers={'Content-Type':content_type}).status_code == 200


@pytest.mark.parametrize('body', [b'{"alert":', b'', b'\xff', b'{"alert":{"x":NaN}}', b'{"alert":{"x":Infinity}}', b'{"alert":{},"alert":{}}', b'{"alert":{"x":1,"x":2}}'])
def test_strict_json_errors_are_clean_and_have_cors(client, body):
    response = client.post('/api/run', content=body, headers={'Content-Type':'application/json','Origin':'http://localhost:5173'})
    assert response.status_code == 422
    assert response.json() == {'error': {'code':'invalid_json','message':'Request body must be valid UTF-8 JSON.','details':None}}
    assert response.headers['access-control-allow-origin'] == 'http://localhost:5173'


def test_request_limit_counts_bytes_and_streamed_chunks(client):
    prefix, suffix = b'{"alert":{"message":"', b'"}}'
    body = prefix + b'x' * (204800 - len(prefix) - len(suffix)) + suffix
    assert client.post('/api/run', content=body, headers={'Content-Type':'application/json'}).status_code == 200
    over = body + b' '
    response = client.post('/api/run', content=iter([over[:100000],over[100000:]]), headers={'Content-Type':'application/json','Origin':'http://localhost:5173'})
    assert response.status_code == 413 and response.json()['error']['code'] == 'payload_too_large'
    assert response.headers['access-control-allow-origin'] == 'http://localhost:5173'
    unicode_body = json.dumps({'alert':{'message':'é'*110000}}, ensure_ascii=False).encode()
    assert client.post('/api/run',content=unicode_body,headers={'Content-Type':'application/json'}).status_code == 413


def test_unexpected_error_is_sanitized_json_with_cors(client, monkeypatch):
    def broken(*args, **kwargs):
        raise RuntimeError('Sensitive upstream response body')
    monkeypatch.setattr(client.app.state.catalog, 'for_alert', broken)
    response = client.post('/api/run', json={'alert':{}}, headers={'Origin':'http://localhost:5173'})
    assert response.status_code == 500
    assert response.json() == {'error':{'code':'internal_error','message':'An internal error occurred.','details':None}}
    assert response.headers['access-control-allow-origin'] == 'http://localhost:5173'


def test_cors_denies_unconfigured_origin(client):
    response = client.options('/api/run',headers={'Origin':'https://example.org','Access-Control-Request-Method':'POST'})
    assert 'access-control-allow-origin' not in response.headers
