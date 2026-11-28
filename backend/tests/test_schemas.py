import ast
import json
from copy import deepcopy

import pytest
from jsonschema import Draft202012Validator
from pydantic import ValidationError

from backend.app.config import ROOT, Settings
from backend.app.schemas import Checklist, IncidentTicket, ParsedAlert, strict_json_schema
from backend.app.verify import apply_fallback_rules, require_valid_citations


@pytest.mark.parametrize("model", [ParsedAlert, Checklist, IncidentTicket])
def test_exports_are_strict_and_current(model, catalog):
    schema = json.loads((ROOT / "docs" / "schemas" / f"{model.__name__}.json").read_text())
    assert schema == strict_json_schema(model)
    Draft202012Validator.check_schema(schema)
    validator = Draft202012Validator(schema)
    values = [catalog.ticket] if model is IncidentTicket else [
        run.parsed if model is ParsedAlert else run.checklist for run in catalog.runs.values()
    ]
    for value in values:
        validator.validate(value.model_dump())

    def visit(node):
        if isinstance(node, dict):
            if node.get("type") == "object":
                assert node["additionalProperties"] is False
                assert set(node["required"]) == set(node["properties"])
            for item in node.values():
                visit(item)
        elif isinstance(node, list):
            for item in node:
                visit(item)

    visit(schema)


@pytest.mark.parametrize("field,value", [
    ("attack_type", "malware"), ("severity", "HIGH"), ("confidence", 1.1),
    ("confidence", float("nan")), ("redacted", "false"), ("timestamp", "yesterday"),
    ("summary", "One sentence. Two sentences. Three sentences."),
])
def test_invalid_parsed_alerts_rejected(field, value, catalog):
    data = catalog.runs["ALR-RAN"].parsed.model_dump()
    data[field] = value
    with pytest.raises(ValidationError):
        ParsedAlert.model_validate(data)


def test_nullable_fields_are_required_and_iocs_deduplicate(catalog):
    data = catalog.runs["ALR-RAN"].parsed.model_dump()
    data["timestamp"] = None
    data["iocs"]["ips"] *= 2
    assert ParsedAlert.model_validate(data).iocs.ips == ["192.0.2.10"]
    del data["timestamp"]
    with pytest.raises(ValidationError):
        ParsedAlert.model_validate(data)
    data["timestamp"], data["invented_field"] = None, True
    with pytest.raises(ValidationError):
        ParsedAlert.model_validate(data)


@pytest.mark.parametrize("mutation", ["order", "playbook", "escalation", "no_match"])
def test_checklist_invariants(mutation, catalog):
    data = catalog.runs["ALR-RAN"].checklist.model_dump()
    if mutation == "order":
        data["steps"][0]["order"] = 2
    elif mutation == "playbook":
        data["steps"][0]["citation"]["playbook_id"] = "PB-PHI"
    elif mutation == "escalation":
        data["status"] = "low_confidence"
    else:
        data.update(status="no_matching_sop", escalation_note="Escalate.")
    with pytest.raises(ValidationError):
        Checklist.model_validate(data)


@pytest.mark.parametrize("field,value", [
    ("step_id", "PB-RAN-99"), ("source_text", "Invented source text"),
])
def test_citation_gate_checks_actual_steps(field, value, catalog):
    result = catalog.runs["ALR-RAN"].checklist.model_copy(deep=True)
    result.steps[0].citation = result.steps[0].citation.model_copy(update={field: value})
    with pytest.raises(ValueError, match="Citation"):
        require_valid_citations(result, catalog.citations)


@pytest.mark.parametrize("reason", ["unknown", "score", "margin", "steps"])
def test_fallback_rules_are_enforced(reason, catalog, settings):
    run = catalog.runs["ALR-RAN"].model_copy(deep=True)
    margin = 1.0
    if reason == "unknown":
        run.parsed.attack_type = "unknown"
    elif reason == "score":
        run.checklist.retrieval_confidence = 0.1
    elif reason == "margin":
        margin = 0.01
    else:
        run.checklist.steps = run.checklist.steps[:1]
    result = apply_fallback_rules(run.checklist, run.parsed, settings, margin=margin)
    assert result.status == ("low_confidence" if reason == "steps" else "no_matching_sop")
    assert result.escalation_note
    assert bool(result.steps) == (reason == "steps")


def test_ticket_approval_and_identifier_invariants(catalog):
    for update in [
        {"ticket_id": "bad-id"}, {"status": "approved"}, {"audit_ref": "different-run"},
        {"approved_by": "Analyst"},
    ]:
        data = {**catalog.ticket.model_dump(), **update}
        with pytest.raises(ValidationError):
            IncidentTicket.model_validate(data)


def test_only_llm_module_imports_sdk():
    for path in (ROOT / "backend").rglob("*.py"):
        imports = []
        for node in ast.walk(ast.parse(path.read_text())):
            if isinstance(node, ast.Import):
                imports.extend(alias.name.split(".")[0] for alias in node.names)
            elif isinstance(node, ast.ImportFrom) and node.module:
                imports.append(node.module.split(".")[0])
        if "openai" in imports:
            assert path == ROOT / "backend" / "app" / "llm.py"


def test_environment_settings(monkeypatch, tmp_path):
    monkeypatch.setenv("MOCK", "1")
    monkeypatch.setenv("TLS_VERIFY", "true")
    monkeypatch.setenv("MODEL_MAIN", "configured-model")
    monkeypatch.setenv("MODEL_FAST", "configured-fast")
    monkeypatch.setenv("MODEL_FALLBACK", "configured-fallback")
    monkeypatch.setenv("MODEL_EMBED", "configured-embed")
    monkeypatch.setenv("LLM_BASE_URL", "https://example.com/")
    settings = Settings(_env_file=None, data_dir=tmp_path)
    assert settings.mock and settings.tls_verify
    assert settings.model_main == "configured-model"
    assert settings.model_fast == "configured-fast"
    assert settings.model_fallback == "configured-fallback"
    assert settings.model_embed == "configured-embed"
    assert settings.llm_base_url == "https://example.com/"

