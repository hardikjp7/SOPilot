"""Contract v1. Nullable properties remain required for strict structured output."""

import json
import re
from datetime import datetime
from pathlib import Path
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

AttackType = Literal["phishing", "ransomware", "credential_stuffing", "ddos", "public_s3_bucket", "unknown"]
Severity = Literal["low", "medium", "high", "critical"]
ChecklistStatus = Literal["grounded", "low_confidence", "no_matching_sop"]
Stage = Literal["parse", "retrieve", "generate", "verify", "ticket", "approve"]
Confidence = Annotated[float, Field(ge=0, le=1)]


class ContractModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False)


def iso_timestamp(value: str | None) -> str | None:
    if value is not None:
        if "T" not in value:
            raise ValueError("Expected an ISO 8601 timestamp")
        datetime.fromisoformat(value.replace("Z", "+00:00"))
    return value


class IOCs(ContractModel):
    ips: list[str]
    domains: list[str]
    urls: list[str]
    hashes: list[str]
    emails: list[str]
    users: list[str]
    cve_ids: list[str]
    resources: list[str]

    @field_validator("*")
    @classmethod
    def deduplicate(cls, value: list[str]) -> list[str]:
        return list(dict.fromkeys(value))


class Citation(ContractModel):
    playbook_id: str
    step_id: str
    source_text: str


class ParsedAlert(ContractModel):
    alert_id: str
    source: str
    timestamp: str | None
    attack_type: AttackType
    severity: Severity
    confidence: Confidence
    summary: str
    iocs: IOCs
    evidence_fields: list[str]
    redacted: bool

    _timestamp = field_validator("timestamp")(iso_timestamp)

    @field_validator("summary")
    @classmethod
    def at_most_two_sentences(cls, value: str) -> str:
        if len(re.split(r"(?<=[.!?])\s+(?=[A-Z0-9])", value.strip())) > 2:
            raise ValueError("Summary must contain at most two sentences")
        return value


class AlertClassification(ContractModel):
    """Internal fast-model output; identity, metadata and IoCs stay deterministic."""

    attack_type: AttackType
    severity: Severity
    confidence: Confidence
    summary: str
    evidence_fields: list[str]

    @field_validator("summary")
    @classmethod
    def at_most_two_sentences(cls, value: str) -> str:
        return ParsedAlert.at_most_two_sentences(value)


class Step(ContractModel):
    order: int = Field(ge=1)
    action: str
    rationale: str
    citation: Citation
    verified: bool
    support: Literal["supported", "partial"]


class RelatedCVE(ContractModel):
    id: str
    severity: Severity
    cvss: float | None
    remediation: str


class Checklist(ContractModel):
    alert_id: str
    status: ChecklistStatus
    playbook_id: str | None
    retrieval_confidence: Confidence
    steps: list[Step]
    related_cves: list[RelatedCVE]
    escalation_note: str
    dropped_count: int = Field(ge=0)

    @model_validator(mode="after")
    def check_invariants(self) -> "Checklist":
        if [s.order for s in self.steps] != list(range(1, len(self.steps) + 1)):
            raise ValueError("Step order must be one-based and contiguous")
        if any(s.citation.playbook_id != self.playbook_id for s in self.steps):
            raise ValueError("Every citation must belong to the chosen playbook")
        if self.status == "no_matching_sop" and self.steps:
            raise ValueError("No matching SOP must have no steps")
        if self.status == "grounded":
            if self.escalation_note != "":
                raise ValueError("Grounded checklists have an empty escalation note")
        elif not self.escalation_note.strip():
            raise ValueError("Non-grounded checklists require an escalation note")
        return self


class TimelineEvent(ContractModel):
    time: str | None
    event: str


class RootCause(ContractModel):
    hypothesis: str
    confidence: Confidence
    basis: list[str]

    @field_validator('hypothesis')
    @classmethod
    def labeled_hypothesis(cls, value: str) -> str:
        if not value.strip().lower().startswith('hypothesis:'):
            raise ValueError('Root cause must start with Hypothesis:')
        return value


class ContainmentAction(ContractModel):
    action: str
    citation: Citation
    status: Literal["recommended", "approved"]


class IncidentTicket(ContractModel):
    ticket_id: str = Field(pattern=r"^INC-\d{8}-\d{3}$")
    run_id: str
    title: str
    severity: Severity
    status: Literal["draft", "approved"]
    timeline: list[TimelineEvent]
    root_cause: RootCause
    iocs: IOCs
    containment_actions: list[ContainmentAction]
    affected_assets: list[str]
    cves: list[str]
    approved_by: str | None
    approved_at: str | None
    audit_ref: str

    _approved_at = field_validator("approved_at")(iso_timestamp)

    @model_validator(mode="after")
    def check_approval(self) -> "IncidentTicket":
        if self.audit_ref != self.run_id:
            raise ValueError("audit_ref must equal run_id")
        if self.status == "approved":
            if not self.approved_by or not self.approved_by.strip() or not self.approved_at:
                raise ValueError("Approved tickets require analyst and timestamp")
            if any(a.status != "approved" for a in self.containment_actions):
                raise ValueError("Approved ticket actions must be approved")
        elif self.approved_by is not None or self.approved_at is not None:
            raise ValueError("Draft tickets cannot have approval metadata")
        return self


class Health(ContractModel):
    status: Literal["ok"]
    mock: bool
    index_chunks: int = Field(ge=0)


class Sample(ContractModel):
    id: str
    name: str
    alert: dict[str, Any]


class AlertRequest(ContractModel):
    alert: dict[str, Any]


class ChecklistRequest(ContractModel):
    parsed: ParsedAlert


class TicketRequest(ContractModel):
    run_id: str


class ApproveRequest(ContractModel):
    ticket_id: str
    analyst_name: str = Field(min_length=1)

    @field_validator("analyst_name")
    @classmethod
    def nonblank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Analyst name cannot be blank")
        return value.strip()


class Timings(ContractModel):
    parse: float = Field(ge=0)
    retrieve: float = Field(ge=0)
    generate: float = Field(ge=0)
    verify: float = Field(ge=0)
    total: float = Field(ge=0)


class RunResponse(ContractModel):
    run_id: str
    parsed: ParsedAlert
    checklist: Checklist
    timings_ms: Timings


class SearchHit(ContractModel):
    playbook_id: str
    step_id: str
    text: str
    score: Confidence


class RetrievedChunk(SearchHit):
    semantic_score: Confidence
    keyword_score: Confidence
    metadata: dict[str, str | float]


class RetrievalResult(ContractModel):
    chunks: list[RetrievedChunk]
    retrieval_confidence: Confidence
    margin: Confidence
    meets_thresholds: bool


class LookupCVEArguments(ContractModel):
    id: str


class GeneratedStep(ContractModel):
    action: str
    rationale: str
    playbook_id: str
    step_id: str


class ChecklistDraft(ContractModel):
    steps: list[GeneratedStep]


class TicketContent(ContractModel):
    title: str = Field(min_length=1)
    timeline: list[TimelineEvent]
    root_cause: RootCause
    containment_actions: list[ContainmentAction]
    affected_assets: list[str]
    cves: list[str]


class StepVerdict(ContractModel):
    order: int = Field(ge=1)
    support: Literal['supported', 'partial', 'unsupported']
    reason: str = Field(min_length=1, max_length=500)


class SupportVerdicts(ContractModel):
    verdicts: list[StepVerdict]


class VerificationResult(ContractModel):
    checklist: Checklist
    verdicts: list[StepVerdict]
    dropped_ids: list[str]


class EvalCase(ContractModel):
    case_id: str
    category: Literal['clean', 'reworded', 'ambiguous', 'no_match', 'injection', 'missing_fields']
    alert: dict[str, Any]
    expected_playbook: str | None
    expected_status: ChecklistStatus


class AuditRow(ContractModel):
    id: int
    run_id: str
    stage: Stage
    ts: str
    model: str | None
    input_hash: str
    output_hash: str
    details_json: dict[str, Any]


class ErrorDetail(ContractModel):
    code: str
    message: str
    details: Any


class ErrorResponse(ContractModel):
    error: ErrorDetail


class EmbeddingBatch(ContractModel):
    vectors: list[list[float]]

    @field_validator("vectors")
    @classmethod
    def nonempty_uniform_vectors(cls, value: list[list[float]]) -> list[list[float]]:
        if not value or not value[0] or len({len(v) for v in value}) != 1:
            raise ValueError("Expected nonempty, equally sized embeddings")
        return value


class CVERecord(ContractModel):
    """Internal knowledge-base record; not a change to the v1 HTTP contract."""

    id: str = Field(pattern=r"^CVE-\d{4}-\d{4,}$")
    cvss: float = Field(ge=0, le=10)
    severity: Severity
    affected_product: str = Field(min_length=1)
    description: str = Field(min_length=1)
    remediation: str = Field(min_length=1)
    related_playbooks: list[str]


def strict_json_schema(model: type[ContractModel]) -> dict[str, Any]:
    schema = model.model_json_schema()

    def visit(node: Any) -> None:
        if isinstance(node, dict):
            node.pop("default", None)
            if node.get("type") == "object":
                node["additionalProperties"] = False
                node["required"] = list(node.get("properties", {}))
            for value in node.values():
                visit(value)
        elif isinstance(node, list):
            for value in node:
                visit(value)

    visit(schema)
    return schema


def export_schemas(destination: Path | None = None) -> None:
    destination = destination or Path(__file__).resolve().parents[2] / "docs" / "schemas"
    destination.mkdir(parents=True, exist_ok=True)
    for model in (ParsedAlert, Checklist, IncidentTicket, RunResponse, AuditRow):
        (destination / f"{model.__name__}.json").write_text(
            json.dumps(model.model_json_schema(), indent=2) + "\n", encoding="utf-8"
        )


if __name__ == "__main__":
    export_schemas()

