import type { Citation, IncidentTicket, Iocs } from '../api/types';

// Ticket strings remain literal text in Markdown rather than active HTML/links.
function text(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/[\\`*_[\]{}()#!|]/g, '\\$&').replace(/\r?\n/g, ' ');
}

function citationMarkdown(citation: Citation): string {
  // A longer fence preserves exact source text even when it contains backticks.
  const runs = citation.source_text.match(/`+/g) ?? [];
  const fence = '`'.repeat(Math.max(3, ...runs.map((run) => run.length + 1)));
  return `Citation: ${text(citation.playbook_id)} / ${text(citation.step_id)}\n\n`
    + `${fence}text\n${citation.source_text}\n${fence}`;
}

function list(values: string[]): string {
  return values.length ? values.map((value) => `- ${text(value)}`).join('\n') : 'None provided.';
}

const iocLabels: Record<keyof Iocs, string> = {
  ips: 'IP addresses', domains: 'Domains', urls: 'URLs', hashes: 'Hashes',
  emails: 'Emails', users: 'Users', cve_ids: 'CVE IDs', resources: 'Resources',
};

export function ticketToMarkdown(ticket: IncidentTicket): string {
  const iocs = (Object.keys(iocLabels) as (keyof Iocs)[])
    .filter((key) => ticket.iocs[key].length)
    .map((key) => `### ${iocLabels[key]}\n\n${list(ticket.iocs[key])}`);
  const actions = ticket.containment_actions.map((action, index) => (
    `### ${index + 1}. ${text(action.action)}\n\nStatus: ${text(action.status)}\n\n`
    + citationMarkdown(action.citation)
  ));

  return [
    `# ${text(ticket.ticket_id)}: ${text(ticket.title)}`,
    `- Status: ${text(ticket.status)}\n- Severity: ${text(ticket.severity)}\n`
      + `- Run: ${text(ticket.run_id)}\n- Audit reference: ${text(ticket.audit_ref)}`,
    '## Timeline',
    ticket.timeline.length
      ? ticket.timeline.map((event) => `- ${text(event.time ?? 'Time not provided')}: ${text(event.event)}`).join('\n')
      : 'No timeline events provided.',
    '## Root cause hypothesis',
    text(ticket.root_cause.hypothesis),
    `Confidence: ${Math.round(ticket.root_cause.confidence * 100)}%`,
    `### Basis\n\n${list(ticket.root_cause.basis)}`,
    '## Indicators of compromise',
    iocs.join('\n\n') || 'No indicators provided.',
    '## Containment actions',
    actions.join('\n\n') || 'No containment actions provided.',
    `## Affected assets\n\n${list(ticket.affected_assets)}`,
    `## CVEs\n\n${list(ticket.cves)}`,
    '## Approval',
    `- Approved by: ${text(ticket.approved_by ?? 'Not provided')}\n`
      + `- Approved at: ${text(ticket.approved_at ?? 'Not provided')}`,
  ].join('\n\n') + '\n';
}
