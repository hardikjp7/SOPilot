"""Export the five frontend JSON Schemas: python scripts/export_contract.py."""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.app.schemas import export_schemas


def main():
    export_schemas(ROOT/'docs/schemas')
    print('Exported ParsedAlert, Checklist, IncidentTicket, RunResponse and AuditRow to docs/schemas/.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
