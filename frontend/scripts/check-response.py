"""Validate captured responses against the canonical root contract, without I/O to the API."""
import json
from pathlib import Path
import re
import sys

from jsonschema import Draft202012Validator

ROOT = Path(__file__).resolve().parents[2]


def describe(value):
    if value is None:
        return "null"
    if isinstance(value, bool):
        return str(value).lower()
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, str) and re.fullmatch(r"[A-Za-z_]{1,40}", value):
        return json.dumps(value)
    return {str: "string", list: "array", dict: "object"}.get(type(value), type(value).__name__)


def path_for(parts):
    return "$" + "".join(f"[{part}]" if isinstance(part, int) else f".{part}" for part in parts)


def validate(endpoint, status, body):
    string = {"type": "string"}
    obj = {"type": "object"}
    if status >= 400:
        codes = {"invalid_json": 422, "payload_too_large": 413, "validation_error": 422,
                 "not_found": 404, "already_approved": 409, "llm_unavailable": 503, "internal_error": 500}
        schema = {"type": "object", "required": ["error"], "properties": {"error": {
            "type": "object", "required": ["code", "message", "details"], "properties": {
                "code": {"enum": list(codes)}, "message": string, "details": {},
            },
        }}}
    elif endpoint == "/health":
        schema = {"type": "object", "required": ["status", "mock", "index_chunks"], "properties": {
            "status": {"const": "ok"}, "mock": {"type": "boolean"}, "index_chunks": {"type": "integer", "minimum": 0},
        }}
    elif endpoint == "/samples":
        schema = {"type": "array", "items": {"type": "object", "required": ["id", "name", "alert"],
                  "properties": {"id": string, "name": string, "alert": obj}}}
    else:
        name = {"/run": "RunResponse", "/ticket": "IncidentTicket", "/approve": "IncidentTicket",
                "/alerts/parse": "ParsedAlert", "/checklist": "Checklist", "/audit": "AuditRow"}.get(endpoint)
        if name is None:
            return []
        schema = json.loads((ROOT / "docs/schemas" / f"{name}.json").read_text())
        if endpoint == "/audit":
            schema = {"type": "array", "items": {"$ref": "#/$defs/AuditRow"}, "$defs": {"AuditRow": schema}}
    issues = []
    for error in Draft202012Validator(schema).iter_errors(body):
        if error.validator == "required":
            for name in error.validator_value:
                if name not in error.instance:
                    issues.append({"path": path_for([*error.absolute_path, name]), "expected": "required field", "got": "missing"})
        else:
            issues.append({"path": path_for(error.absolute_path), "expected": f"{error.validator}: {json.dumps(error.validator_value)}", "got": describe(error.instance)})
    if not issues and status >= 400 and codes[body["error"]["code"]] != status:
        issues.append({"path": "$.error.code", "expected": f"HTTP {codes[body['error']['code']]}", "got": f"HTTP {status}"})
    if not issues and status < 400 and endpoint in {"/run", "/checklist"}:
        checklist = body["checklist"] if endpoint == "/run" else body
        if checklist["status"] == "no_matching_sop" and checklist["steps"]:
            issues.append({"path": "$.checklist.steps" if endpoint == "/run" else "$.steps", "expected": "empty array for no_matching_sop", "got": f"{len(checklist['steps'])} steps"})
        if checklist["status"] != "grounded" and not checklist["escalation_note"].strip():
            issues.append({"path": "$.checklist.escalation_note" if endpoint == "/run" else "$.escalation_note", "expected": "non-empty escalation note", "got": "empty string"})
    return issues


if __name__ == "__main__":
    request = json.load(sys.stdin)
    print(json.dumps(validate(request["endpoint"], request["status"], request["body"])))
