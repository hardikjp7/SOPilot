"""Shared validation for the synthetic frontend contract handoff."""
import html
import ipaddress
import json
import os
from pathlib import Path
import re

from pydantic import TypeAdapter

from backend.app.config import ROOT, Settings
from backend.app.parser import DOMAIN, FILE_SUFFIXES, ip_matches, walk
from backend.app.schemas import AuditRow, Health, IncidentTicket, RunResponse, Sample

SCHEMA_NAMES = ('ParsedAlert', 'Checklist', 'IncidentTicket', 'RunResponse', 'AuditRow')
SAMPLE_NAMES = ('phishing', 'ransomware', 'credential_stuffing', 'public_s3_bucket', 'ambiguous', 'unknown')
GOLDEN_NAMES = tuple(f'run-{name}.json' for name in SAMPLE_NAMES) + (
    'ticket-draft.json', 'ticket-approved.json', 'audit.json', 'health.json', 'samples.json', 'ticket-export.md',
)
NETWORKS = tuple(map(ipaddress.ip_network, ('192.0.2.0/24','198.51.100.0/24','203.0.113.0/24','2001:db8::/32')))


def contract_version(root: Path = ROOT) -> str:
    matches = re.findall(r'^Contract version:\s*v?(\d+(?:\.\d+)*)\s*$', (root/'docs/spec.md').read_text(), re.MULTILINE)
    if len(matches) != 1:
        raise ValueError('Expected one Contract version header in docs/spec.md')
    return matches[0]


def ensure_changelog(root: Path = ROOT):
    path = root/'docs/CHANGELOG-contract.md'
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text('v1: Initial frontend/backend contract.\n', encoding='utf-8')


def scan_secrets(content: bytes):
    # Compare configured values without displaying any credential or exception body.
    settings = Settings()
    secrets = [settings.llm_key.get_secret_value()] if settings.llm_key else []
    secrets += [value for key, value in os.environ.items() if re.search(r'(?:KEY|TOKEN|SECRET|PASSWORD)$', key, re.I) and len(value) >= 8]
    for value in secrets:
        if value and any(form in content for form in (value.encode(), json.dumps(value)[1:-1].encode(), html.escape(value).encode())):
            raise ValueError('Credential value detected in handoff content')
    if re.search(rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bsk-[A-Za-z0-9_-]{20,}|\bAKIA[A-Z0-9]{16}\b', content):
        raise ValueError('Credential pattern detected in handoff content')


def synthetic_content(value):
    """Network indicators in goldens must remain inside documentation namespaces."""
    for _, key, _, item in walk(value):
        if not isinstance(item, str):
            continue
        text = html.unescape(item)
        for _, address in ip_matches(text):
            ip = ipaddress.ip_address(address)
            if not any(ip.version == net.version and ip in net for net in NETWORKS):
                raise ValueError('Non-documentation IP in golden content')
        for match in DOMAIN.finditer(text):
            domain = match[0].lower()
            if domain.rsplit('.',1)[-1] in FILE_SUFFIXES:
                continue
            if not any(domain == base or domain.endswith('.' + base) for base in ('example.com','example.org','example.net','example.test','example.invalid')):
                raise ValueError('Non-example domain in golden content')
        if re.search(r'password|api.?key|access.?token|secret.?key|authorization|cookie', key, re.I) and text.strip():
            raise ValueError('Credential-like field in golden content')


def local_samples(root: Path = ROOT):
    result = {}
    for name in SAMPLE_NAMES:
        alert = json.loads((root/'data/alerts'/f'{name}.json').read_text())
        if alert.get('synthetic') is not True:
            raise ValueError('Only explicitly synthetic seed alerts may be exported')
        synthetic_content(alert)
        result[name] = alert
    return result


def validate_goldens(blobs: dict[str, bytes], root: Path = ROOT):
    if set(blobs) != set(GOLDEN_NAMES):
        raise ValueError('Golden set is incomplete or contains unexpected files')
    for name, blob in blobs.items():
        scan_secrets(blob)
        synthetic_content(blob.decode('utf-8'))
    health = Health.model_validate_json(blobs['health.json'])
    if health.mock:
        raise ValueError('Golden responses require a real backend with MOCK=0')
    samples = TypeAdapter(list[Sample]).validate_json(blobs['samples.json'])
    seeds = local_samples(root)
    if len(samples) != 6 or {s.id: s.alert for s in samples} != {a['alert_id']: a for a in seeds.values()}:
        raise ValueError('Backend samples differ from the six checked-in synthetic alerts')
    runs = {name: RunResponse.model_validate_json(blobs[f'run-{name}.json']) for name in SAMPLE_NAMES}
    for name, run in runs.items():
        if run.parsed.alert_id != seeds[name]['alert_id'] or run.checklist.alert_id != run.parsed.alert_id:
            raise ValueError('Golden run does not match the sample alert')
        if any(not step.verified for step in run.checklist.steps):
            raise ValueError('Golden runs must contain verified steps only')
    draft = IncidentTicket.model_validate_json(blobs['ticket-draft.json'])
    approved = IncidentTicket.model_validate_json(blobs['ticket-approved.json'])
    selected = next((r for r in runs.values() if r.run_id == draft.run_id), None)
    if selected is None or selected.checklist.status != 'grounded' or draft.status != 'draft':
        raise ValueError('Draft ticket must belong to an exported grounded run')
    if draft.iocs != selected.parsed.iocs or draft.severity != selected.parsed.severity:
        raise ValueError('Draft ticket evidence differs from the selected run')
    actions = [(s.action, s.citation) for s in selected.checklist.steps if s.verified]
    if [(a.action, a.citation) for a in draft.containment_actions] != actions:
        raise ValueError('Draft ticket actions differ from the verified checklist')
    expected = draft.model_dump()
    expected.update(status='approved', approved_by='Demo Analyst', approved_at=approved.approved_at)
    for action in expected['containment_actions']:
        action['status'] = 'approved'
    if approved.model_dump() != expected:
        raise ValueError('Approved ticket differs from the expected approval transition')
    rows = TypeAdapter(list[AuditRow]).validate_json(blobs['audit.json'])
    if [r.stage for r in rows] != ['parse','retrieve','generate','verify','ticket','approve'] or any(r.run_id != draft.run_id for r in rows):
        raise ValueError('Audit must contain all six stages for the selected run')
    if rows[-1].details_json.get('analyst_name') != 'Demo Analyst':
        raise ValueError('Audit analyst does not match the approval')
    from backend.app.audit import digest
    if rows[-2].output_hash != digest(draft.model_dump()) or rows[-1].output_hash != digest(approved.model_dump()):
        raise ValueError('Audit ticket hashes do not match the exported tickets')
    markdown = blobs['ticket-export.md'].decode('utf-8')
    if approved.ticket_id not in markdown or 'Demo Analyst' not in markdown:
        raise ValueError('Markdown export does not match the approved ticket')
    return runs
