import { AppError } from '../lib/errors';
import { ticketToMarkdown } from '../lib/ticketToMarkdown';
import { draftTicketFixtures } from '../mocks/ticketFixtures';
import {
  approvedTicket,
  auditRows,
  draftTicket,
  pickRunKey,
  runFixtures,
  samples,
} from '../mocks/fixtures';
import type { ApiClient, SearchHit } from './types';

// The mock index contains only exact citation text supplied in the fixtures.
const searchHits = Array.from(new Map(
  Object.values(runFixtures).flatMap((run) => run.checklist.steps.map(({ citation }) => [
    citation.step_id,
    {
      playbook_id: citation.playbook_id,
      step_id: citation.step_id,
      text: citation.source_text,
      score: run.checklist.retrieval_confidence,
    } satisfies SearchHit,
  ] as const)),
).values());

async function respond<T>(value: () => T): Promise<T> {
  await new Promise<void>((resolve) => setTimeout(resolve, 300 + Math.floor(Math.random() * 501)));
  return structuredClone(value());
}

export function createMockClient(): ApiClient {
  // State belongs to one mock client; exported fixtures are never mutated.
  const approvedIds = new Set<string>();

  function ticketFor(ticketId: string) {
    const ticket = draftTicketFixtures.find((item) => item.ticket_id === ticketId);
    if (!ticket) throw new AppError('not_found');
    if (!approvedIds.has(ticketId)) return ticket;
    if (ticketId === draftTicket.ticket_id) return approvedTicket;
    return {
      ...ticket, status: 'approved' as const,
      approved_by: approvedTicket.approved_by, approved_at: approvedTicket.approved_at,
      containment_actions: ticket.containment_actions.map((action) => ({ ...action, status: 'approved' as const })),
    };
  }

  return {
    health: () => respond(() => ({ status: 'ok', mock: true, index_chunks: searchHits.length } as const)),
    samples: () => respond(() => samples),
    run: (alert) => respond(() => runFixtures[pickRunKey(alert)]),
    parse: (alert) => respond(() => runFixtures[pickRunKey(alert)].parsed),
    checklist: (parsed) => respond(() => (
      Object.values(runFixtures).find((run) => run.parsed.alert_id === parsed.alert_id)
        ?? runFixtures[pickRunKey(parsed)]
    ).checklist),
    createTicket: (runId) => respond(() => {
      const ticket = draftTicketFixtures.find((item) => item.run_id === runId);
      if (!ticket) throw new AppError('not_found');
      return ticket;
    }),
    approve: (ticketId, analystName) => respond(() => {
      ticketFor(ticketId);
      if (approvedIds.has(ticketId)) throw new AppError('already_approved');
      if (!analystName.trim()) throw new AppError('validation_error');
      approvedIds.add(ticketId);
      return ticketFor(ticketId);
    }),
    exportTicketMarkdown: (ticketId) => respond(() => ticketToMarkdown(ticketFor(ticketId))),
    search: (q, k = 6) => respond(() => {
      if (!Number.isInteger(k) || k < 1) throw new AppError('validation_error');
      const term = q.trim().toLowerCase();
      if (!term) return [];
      return searchHits.filter((hit) => hit.text.toLowerCase().includes(term)).slice(0, k);
    }),
    audit: (runId) => respond(() => auditRows.filter((row) => row.run_id === runId)),
  };
}

export const mockClient = createMockClient();
