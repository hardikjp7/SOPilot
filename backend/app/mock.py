"""Validated disk fixtures; unknown inputs safely select the no-match scenario."""

import json
from pathlib import Path
from typing import TypeVar

from .config import ROOT
from .ingest import load_citations
from .parser import alert_identifier
from .schemas import (
    Checklist, ContractModel, Health, IncidentTicket, ParsedAlert, RunResponse, Sample, SearchHit,
)
from .verify import require_valid_citations

Output = TypeVar("Output", bound=ContractModel)


class MockCatalog:
    def __init__(self, directory: Path | None = None) -> None:
        self.directory = directory or ROOT / "data" / "mock"
        self.citations = load_citations(ROOT / "data" / "playbooks")
        self.runs = {}
        for path in sorted(self.directory.glob("*.run.json")):
            run = RunResponse.model_validate_json(path.read_text(encoding="utf-8"))
            require_valid_citations(run.checklist, self.citations)
            if run.parsed.alert_id != run.checklist.alert_id:
                raise ValueError("Mock run alert IDs do not match")
            self.runs[run.parsed.alert_id] = run
        self.samples = [Sample.model_validate(item) for item in self.read("samples.json")]
        self.search = [SearchHit.model_validate(item) for item in self.read("search.json")]
        self.health = Health.model_validate(self.read("health.json"))
        self.ticket = IncidentTicket.model_validate(self.read("ticket.json"))
        require_valid_citations(self.ticket, self.citations)

    def read(self, name: str):
        return json.loads((self.directory / name).read_text(encoding="utf-8"))

    def for_alert(self, alert: dict) -> RunResponse:
        identifier = alert_identifier(alert)
        base = self.runs.get(identifier, self.runs["ALR-NOMATCH"])
        data = base.model_dump()
        data["parsed"]["alert_id"] = identifier
        data["checklist"]["alert_id"] = identifier
        return RunResponse.model_validate(data)

    def for_parsed(self, parsed: ParsedAlert) -> Checklist:
        run = self.runs.get(parsed.alert_id)
        if run is None or run.parsed.attack_type != parsed.attack_type:
            run = next(
                (r for r in self.runs.values() if r.parsed.attack_type == parsed.attack_type),
                self.runs["ALR-NOMATCH"],
            )
        data = run.checklist.model_dump()
        data["alert_id"] = parsed.alert_id
        return Checklist.model_validate(data)

    def model_output(self, model: type[Output]) -> Output:
        canned = {
            ParsedAlert: self.runs["ALR-RAN"].parsed,
            Checklist: self.runs["ALR-RAN"].checklist,
            IncidentTicket: self.ticket,
        }
        if model not in canned:
            raise ValueError("No canned output for this model schema")
        return model.model_validate(canned[model].model_dump())

