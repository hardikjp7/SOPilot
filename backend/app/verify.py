"""Deterministic citation gate, also applied to every canned/model checklist."""

from collections.abc import Mapping

from .config import Settings
from .schemas import Checklist, Citation, IncidentTicket, ParsedAlert


def index_citations(checklist: Checklist, settings: Settings) -> dict[str, Citation]:
    from .ingest import COLLECTION_NAME, open_chroma
    from .llm import LLMUnavailable
    from chromadb.errors import NotFoundError

    try:
        collection = open_chroma(settings).get_collection(COLLECTION_NAME, embedding_function=None)
    except NotFoundError:
        raise LLMUnavailable('Knowledge-base index is missing; cannot verify citations.') from None
    rows = collection.get(ids=list({s.citation.step_id for s in checklist.steps}),
                          include=['documents', 'metadatas'])
    return {
        identifier: Citation(playbook_id=metadata['playbook_id'], step_id=identifier, source_text=text)
        for identifier, text, metadata in zip(rows['ids'], rows['documents'], rows['metadatas'])
        if metadata.get('kind') == 'playbook' and metadata.get('step_id') == identifier
    }


async def verify_checklist(checklist: Checklist, settings: Settings | None = None, *, llm=None,
                           citations: Mapping[str, Citation] | None = None):
    """Return an audited subset of the input; never accept model-authored steps."""
    from .schemas import Step, StepVerdict, SupportVerdicts, VerificationResult
    from .llm import LLMClient, LLMUnavailable

    settings = settings or Settings()
    if not checklist.steps:
        data = checklist.model_dump()
        if checklist.status != 'no_matching_sop':
            data.update(status='low_confidence', escalation_note='No verified steps remain; escalate to the SOC lead.')
        return VerificationResult(checklist=Checklist.model_validate(data), verdicts=[], dropped_ids=[])
    # Only mock mode can substitute the disk playbook catalogue for the live index.
    if citations is not None and not settings.mock:
        raise ValueError('Live verification must use the persisted index')
    allowed = dict(citations) if citations is not None else index_citations(checklist, settings)
    valid, verdicts, dropped, seen = [], [], [], set()
    for step in checklist.steps:
        citation = step.citation
        if (citation.playbook_id != checklist.playbook_id or allowed.get(citation.step_id) != citation
                or citation.step_id in seen):
            verdicts.append(StepVerdict(order=step.order, support='unsupported',
                                       reason='Citation is missing, mismatched, altered, or duplicated.'))
            dropped.append(citation.step_id)
        else:
            seen.add(citation.step_id)
            valid.append(step)
    if valid:
        if settings.mock:
            # Canned fixture verdicts preserve mock mode's no-network contract.
            judgments = SupportVerdicts(verdicts=[StepVerdict(order=s.order, support=s.support,
                                                             reason='Canned mock support verdict.') for s in valid])
        else:
            client = llm if llm is not None else LLMClient(settings)
            try:
                judgments = SupportVerdicts.model_validate(await client.complete(
                    stage='verify', output_schema=SupportVerdicts,
                    payload={'steps': [{'order': s.order, 'action': s.action,
                                        'source_text': allowed[s.citation.step_id].source_text} for s in valid]},
                ))
            finally:
                if llm is None:
                    await client.close()
        by_order = {v.order: v for v in judgments.verdicts}
        if len(by_order) != len(valid) or len(judgments.verdicts) != len(valid) or set(by_order) != {s.order for s in valid}:
            raise LLMUnavailable('Verifier did not judge exactly the supplied steps.')
        verdicts.extend(judgments.verdicts)
    else:
        by_order = {}
    kept = []
    for step in valid:
        verdict = by_order[step.order]
        if verdict.support == 'unsupported':
            dropped.append(step.citation.step_id)
            continue
        data = step.model_dump()
        data.update(order=len(kept) + 1, verified=True, support=verdict.support)
        kept.append(Step.model_validate(data))
    grounded = len(kept) >= settings.min_verified_steps
    data = checklist.model_dump()
    data.update(steps=[s.model_dump() for s in kept], dropped_count=checklist.dropped_count + len(dropped),
                status='grounded' if grounded else 'low_confidence',
                escalation_note='' if grounded else 'Too few verified steps; request SOC lead review before proceeding.')
    return VerificationResult(checklist=Checklist.model_validate(data),
                              verdicts=sorted(verdicts, key=lambda v: v.order), dropped_ids=dropped)


def require_valid_citations(
    result: Checklist | IncidentTicket, allowed: Mapping[str, Citation]
) -> None:
    items = result.steps if isinstance(result, Checklist) else result.containment_actions
    for item in items:
        citation = item.citation
        if allowed.get(citation.step_id) != citation:
            raise ValueError("Citation must match an allowed playbook step and its exact text")


def apply_fallback_rules(
    checklist: Checklist, parsed: ParsedAlert, settings: Settings, *, margin: float
) -> Checklist:
    data = checklist.model_dump()
    if (
        parsed.attack_type == "unknown"
        or checklist.retrieval_confidence < settings.retrieval_min_score
        or margin < settings.retrieval_min_margin
    ):
        data.update(
            status="no_matching_sop", steps=[],
            escalation_note="No sufficiently confident approved procedure matches; escalate to the SOC lead.",
        )
    elif sum(step.verified for step in checklist.steps) < settings.min_verified_steps:
        data.update(
            status="low_confidence",
            escalation_note="Too few verified steps; request SOC lead review before proceeding.",
        )
    else:
        data.update(status="grounded", escalation_note="")
    return Checklist.model_validate(data)

