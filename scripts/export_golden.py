"""Capture synthetic golden responses from the running live backend."""
import json
import os
from pathlib import Path
import sys
from tempfile import TemporaryDirectory

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import httpx
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict
from backend.app.schemas import Health, RunResponse
from scripts.bundle_utils import local_samples, scan_secrets, synthetic_content, validate_goldens


class ExportSettings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ROOT/'.env', extra='ignore', hide_input_in_errors=True)
    backend_url: str = 'http://127.0.0.1:8000'
    golden_timeout_seconds: float = Field(default=240.0, gt=0)


def capture(client, root: Path = ROOT):
    blobs = {}

    def response(name, method, path, **kwargs):
        result = client.request(method, path, **kwargs)
        if result.status_code != 200:
            raise ValueError(f'Backend returned HTTP {result.status_code}; no golden files published')
        if name.endswith('.json'):
            value = result.json()
            synthetic_content(value)
            blob = (json.dumps(value, indent=2, ensure_ascii=False, allow_nan=False)+'\n').encode('utf-8')
        else:
            if not result.headers.get('content-type','').startswith('text/markdown'):
                raise ValueError('Backend export is not Markdown')
            blob = result.content
        scan_secrets(blob)
        blobs[name] = blob
        return result

    health = response('health.json','GET','/api/health')
    if Health.model_validate(health.json()).mock:
        raise ValueError('Refusing canned goldens: start the backend with MOCK=0')
    samples = response('samples.json','GET','/api/samples').json()
    seeds = local_samples(root)
    if len(samples) != 6 or {s['id']:s['alert'] for s in samples} != {a['alert_id']:a for a in seeds.values()}:
        raise ValueError('Backend sample data differs from checked-in synthetic seeds')
    grounded = []
    for name, alert in seeds.items():
        result = response(f'run-{name}.json','POST','/api/run',json={'alert':alert})
        run = RunResponse.model_validate(result.json())
        if run.checklist.status == 'grounded':
            grounded.append(run)
        print(f'{name}: {run.checklist.status}', flush=True)
    if not grounded:
        raise ValueError('No sample run was grounded; cannot capture the requested approval flow')
    ticket = response('ticket-draft.json','POST','/api/ticket',json={'run_id':grounded[0].run_id}).json()
    response('ticket-approved.json','POST','/api/approve',json={'ticket_id':ticket['ticket_id'],'analyst_name':'Demo Analyst'})
    response('audit.json','GET','/api/audit',params={'run_id':grounded[0].run_id})
    response('ticket-export.md','GET',f"/api/tickets/{ticket['ticket_id']}/export.md")
    validate_goldens(blobs, root)
    return blobs


def publish(blobs, destination):
    destination.mkdir(parents=True, exist_ok=True)
    if destination.is_symlink() or any(p.is_symlink() for p in destination.iterdir()):
        raise ValueError('Golden output must not contain symlinks')
    with TemporaryDirectory(prefix='golden-stage-',dir=destination.parent) as staging:
        for name, content in blobs.items():
            (Path(staging)/name).write_bytes(content)
        for name in blobs:
            os.replace(Path(staging)/name,destination/name)


def main():
    settings = ExportSettings()
    try:
        with httpx.Client(base_url=settings.backend_url, timeout=settings.golden_timeout_seconds, trust_env=False) as client:
            blobs = capture(client)
        publish(blobs,ROOT/'golden')
    except Exception as exc:
        # Never print request URLs, credentials, alert bodies, or upstream exceptions.
        print(f'Golden export failed ({type(exc).__name__}); verify live backend health, synthetic seeds and grounding.',file=sys.stderr)
        return 1
    print('Saved and validated all 12 live responses under golden/.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
