import { describe, expect, it } from 'vitest';
import { approvedTicket, draftTicket } from '../mocks/fixtures';
import { ticketToMarkdown } from './ticketToMarkdown';

describe('ticketToMarkdown', () => {
  it('exports draft content, a labelled hypothesis and exact citation text', () => {
    const markdown = ticketToMarkdown(draftTicket);
    expect(markdown).toContain(draftTicket.ticket_id);
    expect(markdown).toContain('- Status: draft');
    expect(markdown).toContain('## Root cause hypothesis');
    expect(markdown).toContain('Confidence: 55%');
    expect(markdown).toContain('198.51.100.23');
    expect(markdown).toContain('CVE-2026-1001');
    expect(markdown).toContain(draftTicket.audit_ref);
    for (const action of draftTicket.containment_actions) {
      expect(markdown).toContain(action.citation.step_id);
      expect(markdown).toContain(action.citation.source_text);
    }
    expect(markdown).toContain('Approved by: Not provided');
    expect(markdown).not.toContain('null');
  });

  it('exports API approval details and action statuses unchanged', () => {
    const markdown = ticketToMarkdown(approvedTicket);
    expect(markdown).toContain('- Status: approved');
    expect(markdown).toContain('Status: approved');
    expect(markdown).toContain('Approved by: Demo Analyst');
    expect(markdown).toContain(approvedTicket.approved_at!);
  });

  it('handles empty actions and nullable timeline times without adding procedures', () => {
    const markdown = ticketToMarkdown({
      ...draftTicket,
      containment_actions: [],
      timeline: [{ time: null, event: 'Escalate to the SOC lead.' }],
    });
    expect(markdown).toContain('No containment actions provided.');
    expect(markdown).toContain('Time not provided: Escalate to the SOC lead.');
    expect(markdown).not.toContain('Citation:');
  });

  it('escapes untrusted HTML and Markdown while safely fencing exact source text', () => {
    const source = 'PB-RAN-01 | Detect | ```\n<script>alert(1)</script>\n```';
    const markdown = ticketToMarkdown({
      ...draftTicket,
      title: '<img src=x onerror=alert(1)> [click](https://example.invalid)',
      containment_actions: [{
        ...draftTicket.containment_actions[0]!,
        citation: { ...draftTicket.containment_actions[0]!.citation, source_text: source },
      }],
    });
    expect(markdown).not.toContain('<img');
    expect(markdown).toContain('&lt;img');
    expect(markdown).toContain('\\[click\\]\\(https://example.invalid\\)');
    expect(markdown).toContain(`\`\`\`\`text\n${source}\n\`\`\`\``);
  });
});
