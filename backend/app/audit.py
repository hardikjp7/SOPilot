"""SQLite run/ticket persistence and append-only stage audit records."""

import hashlib
import json
import sqlite3
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path

from .schemas import AuditRow, IncidentTicket, RunResponse


class NotFound(Exception):
    pass


class AlreadyApproved(Exception):
    pass


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def canonical(value) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def digest(value) -> str:
    return hashlib.sha256(canonical(value).encode()).hexdigest()


class Store:
    def __init__(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        with closing(self.connect()) as db, db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS runs (
                    run_id TEXT PRIMARY KEY, created_at TEXT NOT NULL,
                    alert_json TEXT NOT NULL, parsed_json TEXT NOT NULL,
                    checklist_json TEXT NOT NULL, timings_json TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS tickets (
                    ticket_id TEXT PRIMARY KEY, run_id TEXT NOT NULL UNIQUE,
                    status TEXT NOT NULL, ticket_json TEXT NOT NULL,
                    approved_by TEXT, approved_at TEXT
                );
                CREATE TABLE IF NOT EXISTS audit (
                    id INTEGER PRIMARY KEY, run_id TEXT NOT NULL, stage TEXT NOT NULL,
                    ts TEXT NOT NULL, model TEXT, input_hash TEXT NOT NULL,
                    output_hash TEXT NOT NULL, details_json TEXT NOT NULL,
                    UNIQUE(run_id, stage)
                );
                CREATE TRIGGER IF NOT EXISTS tickets_immutable
                BEFORE UPDATE ON tickets WHEN OLD.status = 'approved'
                BEGIN SELECT RAISE(ABORT, 'approved ticket is immutable'); END;
                CREATE TRIGGER IF NOT EXISTS tickets_no_delete
                BEFORE DELETE ON tickets WHEN OLD.status = 'approved'
                BEGIN SELECT RAISE(ABORT, 'approved ticket is immutable'); END;
                CREATE TRIGGER IF NOT EXISTS tickets_no_replace
                BEFORE INSERT ON tickets WHEN EXISTS (
                    SELECT 1 FROM tickets WHERE (ticket_id=NEW.ticket_id OR run_id=NEW.run_id) AND status='approved'
                )
                BEGIN SELECT RAISE(ABORT, 'approved ticket is immutable'); END;
                CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit
                BEGIN SELECT RAISE(ABORT, 'audit is append-only'); END;
                CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit
                BEGIN SELECT RAISE(ABORT, 'audit is append-only'); END;
                CREATE TRIGGER IF NOT EXISTS audit_no_replace BEFORE INSERT ON audit
                WHEN EXISTS (SELECT 1 FROM audit WHERE id=NEW.id OR (run_id=NEW.run_id AND stage=NEW.stage))
                BEGIN SELECT RAISE(ABORT, 'audit is append-only'); END;
            """)

    def connect(self) -> sqlite3.Connection:
        db = sqlite3.connect(self.path, timeout=30)
        db.row_factory = sqlite3.Row
        return db

    def _audit(self, db, run_id, stage, before, after, details, *, model=None, ts=None) -> None:
        if 'alert_hash' not in details:
            row = db.execute('SELECT alert_json FROM runs WHERE run_id=?', (run_id,)).fetchone()
            if row is None:
                raise NotFound()
            details = {**details, 'alert_hash': digest(json.loads(row[0]))}
        if model is None and details.get('mock'):
            model = 'mock'
        db.execute(
            "INSERT INTO audit (run_id,stage,ts,model,input_hash,output_hash,details_json) "
            "VALUES (?,?,?,?,?,?,?)",
            (run_id, stage, ts or now(), model, digest(before), digest(after), canonical(details)),
        )

    def save_run(self, run: RunResponse, alert: dict, *, stages: list[dict] | None = None) -> None:
        parsed, checklist = run.parsed.model_dump(), run.checklist.model_dump()
        chunks = [s.citation.step_id for s in run.checklist.steps]
        with closing(self.connect()) as db, db:
            db.execute(
                "INSERT INTO runs VALUES (?,?,?,?,?,?)",
                (run.run_id, now(), canonical(alert), canonical(parsed), canonical(checklist),
                 run.timings_ms.model_dump_json()),
            )
            if stages is not None:
                if [s['stage'] for s in stages] != ['parse', 'retrieve', 'generate', 'verify']:
                    raise ValueError('A run requires exactly one record for each pipeline stage')
                for stage in stages:
                    details = {**stage['details'], 'alert_hash': digest(alert)}
                    self._audit(db, run.run_id, stage['stage'], stage['before'], stage['after'],
                                details, model=stage['model'], ts=stage['ts'])
                return
            self._audit(db, run.run_id, "parse", alert, parsed, {"mock": True, 'alert_hash': digest(alert)}, model='mock')
            self._audit(db, run.run_id, "retrieve", parsed, chunks, {"chunk_ids": chunks})
            self._audit(db, run.run_id, "generate", chunks, checklist, {"mock": True})
            self._audit(db, run.run_id, "verify", checklist, checklist, {
                "verdicts": [{"step_id": s.citation.step_id, "support": s.support,
                              'reason': 'Canned mock support verdict.'} for s in run.checklist.steps],
                "dropped_ids": [], "mock": True,
            })

    def get_run(self, run_id: str) -> RunResponse:
        with closing(self.connect()) as db:
            row = db.execute("SELECT * FROM runs WHERE run_id=?", (run_id,)).fetchone()
        if row is None:
            raise NotFound()
        return RunResponse.model_validate({
            "run_id": run_id, "parsed": json.loads(row["parsed_json"]),
            "checklist": json.loads(row["checklist_json"]), "timings_ms": json.loads(row["timings_json"]),
        })

    def ticket_for_run(self, run_id: str) -> IncidentTicket | None:
        self.get_run(run_id)
        with closing(self.connect()) as db:
            row = db.execute('SELECT ticket_json FROM tickets WHERE run_id=?', (run_id,)).fetchone()
        if row is None:
            return None
        ticket = IncidentTicket.model_validate_json(row[0])
        if ticket.status == 'approved':
            raise AlreadyApproved()
        return ticket

    def save_ticket(self, template: IncidentTicket, *, model='mock', payload=None) -> IncidentTicket:
        if template.status != 'draft':
            raise ValueError('New tickets must start as draft')
        run = self.get_run(template.run_id)
        from .ticket import ticket_payload, validate_content
        from .schemas import TicketContent
        if template.iocs != run.parsed.iocs or template.severity != run.parsed.severity:
            raise ValueError('Ticket indicators and severity must match the parsed alert')
        content = TicketContent.model_validate({key: template.model_dump()[key] for key in TicketContent.model_fields})
        validate_content(content, payload or ticket_payload(run, []))
        with closing(self.connect()) as db, db:
            db.execute("BEGIN IMMEDIATE")
            existing = db.execute("SELECT ticket_json FROM tickets WHERE run_id=?", (template.run_id,)).fetchone()
            if existing:
                result = IncidentTicket.model_validate_json(existing[0])
                if result.status == "approved":
                    raise AlreadyApproved()
                return result
            prefix = datetime.now(timezone.utc).strftime("INC-%Y%m%d-")
            number = db.execute("SELECT COUNT(*) FROM tickets WHERE ticket_id LIKE ?", (prefix + "%",)).fetchone()[0] + 1
            data = template.model_dump()
            data["ticket_id"] = f"{prefix}{number:03d}"
            ticket = IncidentTicket.model_validate(data)
            db.execute(
                "INSERT INTO tickets VALUES (?,?,?,?,?,?)",
                (ticket.ticket_id, ticket.run_id, ticket.status, ticket.model_dump_json(), None, None),
            )
            self._audit(db, ticket.run_id, "ticket", payload or {'parsed': run.parsed.model_dump(), 'checklist': run.checklist.model_dump()},
                        ticket.model_dump(), {'alert_hash': self.alert_hash(ticket.run_id)}, model=model)
            return ticket

    def get_ticket(self, ticket_id: str) -> IncidentTicket:
        with closing(self.connect()) as db:
            row = db.execute("SELECT ticket_json FROM tickets WHERE ticket_id=?", (ticket_id,)).fetchone()
        if row is None:
            raise NotFound()
        return IncidentTicket.model_validate_json(row[0])

    def approve(self, ticket_id: str, analyst: str) -> IncidentTicket:
        if not analyst or not analyst.strip():
            raise ValueError('Analyst name is required')
        analyst = analyst.strip()
        with closing(self.connect()) as db, db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT ticket_json FROM tickets WHERE ticket_id=?", (ticket_id,)).fetchone()
            if row is None:
                raise NotFound()
            original = IncidentTicket.model_validate_json(row[0])
            if original.status == "approved":
                raise AlreadyApproved()
            data = original.model_dump()
            data.update(status="approved", approved_by=analyst, approved_at=now())
            for action in data["containment_actions"]:
                action["status"] = "approved"
            ticket = IncidentTicket.model_validate(data)
            db.execute(
                "UPDATE tickets SET status=?,ticket_json=?,approved_by=?,approved_at=? WHERE ticket_id=?",
                (ticket.status, ticket.model_dump_json(), analyst, ticket.approved_at, ticket_id),
            )
            self._audit(db, ticket.run_id, "approve", original.model_dump(), ticket.model_dump(), {
                "analyst_name": analyst, "decision": "approved", 'alert_hash': self.alert_hash(ticket.run_id),
            })
            return ticket

    def alert_hash(self, run_id: str) -> str:
        with closing(self.connect()) as db:
            row = db.execute('SELECT alert_json FROM runs WHERE run_id=?', (run_id,)).fetchone()
        if row is None:
            raise NotFound()
        return digest(json.loads(row[0]))

    def audit_rows(self, run_id: str) -> list[AuditRow]:
        self.get_run(run_id)
        with closing(self.connect()) as db:
            rows = db.execute("SELECT * FROM audit WHERE run_id=? ORDER BY id", (run_id,)).fetchall()
        return [AuditRow.model_validate({**dict(row), "details_json": json.loads(row["details_json"])}) for row in rows]

