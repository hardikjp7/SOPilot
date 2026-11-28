"""Read-only function tool for the local synthetic CVE corpus."""
import json
from pathlib import Path

from .config import ROOT
from .schemas import CVERecord, LookupCVEArguments, strict_json_schema

LOOKUP_CVE_TOOL = {
    'type': 'function', 'name': 'lookup_cve', 'strict': True,
    'description': 'Look up a fictional training CVE in the local corpus; returns remediation or found=false.',
    'parameters': strict_json_schema(LookupCVEArguments),
}

def lookup_cve(id: str, *, data_dir: Path = ROOT / 'data') -> dict:
    arguments = LookupCVEArguments(id=id)
    records = [CVERecord.model_validate(e) for e in json.loads((data_dir / 'cves/cves.json').read_text(encoding='utf-8'))]
    for record in records:
        if record.id == arguments.id.strip().upper():
            return record.model_dump()
    return {'found': False}

def execute_cve_tool(name: str, arguments: str) -> dict:
    if name != LOOKUP_CVE_TOOL['name']:
        raise ValueError('Unknown function tool')
    parsed = LookupCVEArguments.model_validate_json(arguments)
    return lookup_cve(parsed.id)
