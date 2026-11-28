"""Citation-constrained draft checklist generation; support verification is separate."""
import json

from .config import Settings
from .ingest import STEP_LINE
from .llm import LLMClient, LLMUnavailable
from .schemas import Checklist, ChecklistDraft, Citation, ParsedAlert, RelatedCVE, RetrievalResult, Step
from .verify import require_valid_citations
from .cve import lookup_cve


def no_match(parsed: ParsedAlert, confidence: float) -> Checklist:
    return Checklist(alert_id=parsed.alert_id, status='no_matching_sop', playbook_id=None,
                     retrieval_confidence=confidence, steps=[], related_cves=[], dropped_count=0,
                     escalation_note='No sufficiently confident approved procedure matches; escalate to the SOC lead.')


def generation_chunks(parsed: ParsedAlert, retrieval: RetrievalResult):
    if not retrieval.chunks:
        return []
    book = retrieval.chunks[0].playbook_id
    chunks = []
    for chunk in retrieval.chunks:
        match = STEP_LINE.fullmatch(chunk.text)
        if (chunk.playbook_id != book or chunk.metadata.get('attack_type') != parsed.attack_type
                or match is None or match[1] != chunk.step_id
                or chunk.step_id.rsplit('-', 1)[0] != book):
            raise ValueError('Retrieved step is inconsistent with the selected playbook')
        action = match[3]
        # Context is explicitly labeled as data; it cannot introduce another action.
        context = {key: values for key, values in parsed.iocs.model_dump().items()
                   if key in {'ips', 'users', 'resources', 'domains', 'emails'} and values}
        allowed_action = action + (' Context from alert: ' + json.dumps(context, ensure_ascii=False) if context else '')
        chunks.append({'playbook_id': book, 'step_id': chunk.step_id, 'source_text': chunk.text,
                       'allowed_action': allowed_action})
    return chunks


async def generate_checklist(parsed: ParsedAlert, retrieval: RetrievalResult,
                             settings: Settings | None = None, *, llm: LLMClient | None = None) -> Checklist:
    settings = settings or Settings()
    if (parsed.attack_type == 'unknown' or retrieval.retrieval_confidence < settings.retrieval_min_score
            or retrieval.margin < settings.retrieval_min_margin or not retrieval.chunks):
        return no_match(parsed, retrieval.retrieval_confidence)
    chunks = generation_chunks(parsed, retrieval)
    client = llm if llm is not None else LLMClient(settings)
    try:
        draft = ChecklistDraft.model_validate(await client.generate_checklist(
            {'parsed': parsed.model_dump(), 'chunks': chunks}))
    finally:
        if llm is None:
            await client.close()
    allowed = {chunk['step_id']: chunk for chunk in chunks}
    steps, seen = [], set()
    for step in draft.steps:
        chunk = allowed.get(step.step_id)
        if (chunk is None or step.step_id in seen or step.playbook_id != chunk['playbook_id']
                or step.action != chunk['allowed_action']):
            raise LLMUnavailable('The model returned an unsupported action or citation.')
        seen.add(step.step_id)
        steps.append(Step(order=len(steps) + 1, action=step.action, rationale=step.rationale,
                          citation=Citation(playbook_id=step.playbook_id, step_id=step.step_id,
                                            source_text=chunk['source_text']), verified=False, support='partial'))
    related = []
    for identifier in dict.fromkeys(parsed.iocs.cve_ids):
        record = lookup_cve(identifier)
        if record.get('found') is not False:
            related.append(RelatedCVE(id=record['id'], severity=record['severity'], cvss=record['cvss'], remediation=record['remediation']))
    result = Checklist(alert_id=parsed.alert_id, status='low_confidence', playbook_id=chunks[0]['playbook_id'],
                       retrieval_confidence=retrieval.retrieval_confidence, steps=steps, related_cves=related,
                       escalation_note='Generated draft requires support verification and analyst review before use.', dropped_count=0)
    require_valid_citations(result, {c['step_id']: Citation(playbook_id=c['playbook_id'], step_id=c['step_id'], source_text=c['source_text']) for c in chunks})
    return result
