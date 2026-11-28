"""Evidence-constrained ticket drafting and Markdown export."""

from .schemas import IncidentTicket, RunResponse


def draft_from_run(template: IncidentTicket, run: RunResponse) -> IncidentTicket:
    data = template.model_dump()
    data.update(
        run_id=run.run_id, audit_ref=run.run_id, title=f"Mock incident: {run.parsed.attack_type}",
        severity=run.parsed.severity, iocs=run.parsed.iocs.model_dump(),
        cves=run.parsed.iocs.cve_ids, affected_assets=run.parsed.iocs.resources,
        timeline=[{"time": run.parsed.timestamp, "event": run.parsed.summary}],
        containment_actions=[{
            "action": step.action, "citation": step.citation.model_dump(), "status": "recommended",
        } for step in run.checklist.steps if step.verified],
        root_cause={
            "hypothesis": "Hypothesis: the synthetic alert may indicate the reported activity; analyst review is required.",
            "confidence": run.parsed.confidence, "basis": [run.parsed.summary],
        },
    )
    if run.checklist.escalation_note:
        data["timeline"].append({"time": None, "event": run.checklist.escalation_note})
    return IncidentTicket.model_validate(data)


def export_markdown(ticket: IncidentTicket) -> str:
    import html
    def safe(value):
        return html.escape(str(value)).replace('\n', ' ').replace('`', '&#96;').replace('[', '&#91;').replace(']', '&#93;')
    lines = [f"# {ticket.ticket_id}: {ticket.title}", "", f"Status: {ticket.status}",
             f"Severity: {ticket.severity}", "", "## Root cause hypothesis", "", ticket.root_cause.hypothesis,
             "", "## Timeline", ""]
    lines.extend(f"- {item.time or 'Time not supplied'}: {item.event}" for item in ticket.timeline)
    lines.extend(["", "## Containment actions", ""])
    lines.extend(f"- {item.action} [{item.citation.step_id}] ({item.status})" for item in ticket.containment_actions)
    if not ticket.containment_actions:
        lines.append("No approved procedure matches; escalate for analyst review.")
    if ticket.approved_by:
        lines.extend(["", f"Approved by: {ticket.approved_by} at {ticket.approved_at}"])
    lines.extend(["", f"Audit reference: {ticket.audit_ref}", ""])
    # Escape untrusted prose before rendering it as Markdown/HTML in clients.
    lines = [safe(line) if not line.startswith('#') else line[:len(line) - len(line.lstrip('#'))] + ' ' + safe(line.lstrip('# ')) for line in lines]
    lines.extend(['## Root cause confidence and basis', '', str(ticket.root_cause.confidence)])
    lines.extend('- ' + safe(b) for b in ticket.root_cause.basis)
    lines.extend(['', '## Affected assets', ''])
    lines.extend('- ' + safe(a) for a in ticket.affected_assets)
    lines.extend(['', '## CVEs', ''])
    lines.extend('- ' + safe(c) for c in ticket.cves)
    lines.extend(['', '## Indicators', ''])
    for kind, values in ticket.iocs.model_dump().items():
        if values:
            lines.append('- ' + kind + ': ' + ', '.join(safe(v) for v in values))
    lines.extend(['', '## Citation sources', ''])
    lines.extend('- ' + safe(a.citation.playbook_id + ' / ' + a.citation.step_id + ': ' + a.citation.source_text)
                 for a in ticket.containment_actions)
    return "\n".join(lines) + '\n'



def ticket_payload(run: RunResponse, events: list[dict]) -> dict:
    allowed_timeline = [{'time': run.parsed.timestamp, 'event': run.parsed.summary}]
    allowed_timeline.extend({'time': row['time'], 'event': row['event']} for row in events)
    if run.checklist.escalation_note:
        allowed_timeline.append({'time': None, 'event': run.checklist.escalation_note})
    actions = [] if run.checklist.status == 'no_matching_sop' else [
        {'action': s.action, 'citation': s.citation.model_dump(), 'status': 'recommended'}
        for s in run.checklist.steps if s.verified]
    return {
        'parsed': run.parsed.model_dump(), 'checklist': run.checklist.model_dump(),
        'allowed_timeline': allowed_timeline, 'allowed_actions': actions,
        'allowed_assets': list(dict.fromkeys(run.parsed.iocs.resources + run.parsed.iocs.ips + run.parsed.iocs.domains)),
        'allowed_cves': list(dict.fromkeys(run.parsed.iocs.cve_ids)),
        'allowed_basis': [run.parsed.summary] + run.parsed.evidence_fields + [s.action for s in run.checklist.steps if s.verified],
    }


def validate_content(content, payload: dict) -> None:
    if not content.root_cause.basis or any(b not in payload['allowed_basis'] for b in content.root_cause.basis):
        raise ValueError('Root cause basis must cite run evidence')
    if content.root_cause.confidence > payload['parsed']['confidence']:
        raise ValueError('Root cause confidence exceeds alert evidence')
    if any(e.model_dump() not in payload['allowed_timeline'] for e in content.timeline):
        raise ValueError('Ticket invents timeline events')
    note = payload['checklist']['escalation_note']
    if note and not any(e.event == note for e in content.timeline):
        raise ValueError('Ticket must carry the escalation note into the timeline')
    actual = [a.model_dump() for a in content.containment_actions]
    expected = payload['allowed_actions']
    if len(actual) != len(expected) or any(actual.count(a) != expected.count(a) for a in actual + expected):
        raise ValueError('Containment actions must exactly match verified steps')
    if any(a not in payload['allowed_assets'] for a in content.affected_assets):
        raise ValueError('Ticket invents affected assets')
    if any(c not in payload['allowed_cves'] for c in content.cves):
        raise ValueError('Ticket invents CVEs')


async def generate_ticket(run: RunResponse, settings, *, llm, events: list[dict]) -> tuple[IncidentTicket, dict]:
    from .schemas import TicketContent
    from .audit import now
    from .llm import LLMUnavailable
    payload = ticket_payload(run, events)
    content = TicketContent.model_validate(await llm.complete(stage='ticket', output_schema=TicketContent, payload=payload))
    try:
        validate_content(content, payload)
    except ValueError:
        raise LLMUnavailable('Ticket content is not grounded in the verified run.') from None
    ticket = IncidentTicket(
        ticket_id='INC-' + now()[:10].replace('-', '') + '-000', run_id=run.run_id,
        severity=run.parsed.severity, status='draft', iocs=run.parsed.iocs,
        approved_by=None, approved_at=None, audit_ref=run.run_id, **content.model_dump())
    return ticket, payload
