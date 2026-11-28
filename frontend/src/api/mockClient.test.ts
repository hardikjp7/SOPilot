import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../lib/errors';
import { ticketToMarkdown } from '../lib/ticketToMarkdown';
import { approvedTicket, auditRows, draftTicket, runFixtures, samples } from '../mocks/fixtures';
import { createMockClient } from './mockClient';
import type { ApiClient } from './types';

// Attach rejection handling before advancing timers, including negative cases.
async function finish<T>(promise: Promise<T>): Promise<T> {
  const settled = Promise.allSettled([promise]);
  await vi.runAllTimersAsync();
  const result = (await settled)[0]!;
  if (result.status === 'rejected') throw result.reason;
  return result.value;
}

describe('mock ApiClient', () => {
  let client: ApiClient;
  beforeEach(() => {
    vi.useFakeTimers();
    client = createMockClient();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('reports mock health and the size of its fixture citation index', async () => {
    const health = await finish(client.health());
    expect(health).toEqual({ status: 'ok', mock: true, index_chunks: 8 });
  });

  it('returns all six samples as independent copies', async () => {
    const result = await finish(client.samples());
    expect(result).toEqual(samples);
    expect(result).toHaveLength(6);
    result[0]!.alert.changed = true;
    expect(await finish(client.samples())).toEqual(samples);
    expect(samples[0]!.alert).not.toHaveProperty('changed');
  });

  it.each([
    ['grounded', { event: 'ransomware' }],
    ['low_confidence', { event: 'phishing link clicked' }],
    ['no_matching_sop', { event: 'USB copy' }],
  ] as const)('returns the %s fixture consistently from run, parse and checklist', async (key, alert) => {
    const expected = runFixtures[key];
    expect(await finish(client.run(alert))).toEqual(expected);
    const parsed = await finish(client.parse(alert));
    expect(parsed).toEqual(expected.parsed);
    expect(await finish(client.checklist(parsed))).toEqual(expected.checklist);
  });

  it('isolates nested run data from callers', async () => {
    const result = await finish(client.run({ event: 'ransomware' }));
    result.parsed.iocs.ips.push('192.0.2.1');
    result.checklist.steps[0]!.citation.source_text = 'Changed';
    expect(await finish(client.run({ event: 'ransomware' }))).toEqual(runFixtures.grounded);
  });

  it('returns the supplied draft ticket without mutating it', async () => {
    const result = await finish(client.createTicket(draftTicket.run_id));
    expect(result).toEqual(draftTicket);
    result.containment_actions.length = 0;
    expect(await finish(client.createTicket(draftTicket.run_id))).toEqual(draftTicket);
  });

  it('approves once, then rejects with already_approved even after another draft request', async () => {
    expect(await finish(client.approve(draftTicket.ticket_id, 'Demo Analyst'))).toEqual(approvedTicket);
    await finish(client.createTicket(draftTicket.run_id));
    await expect(finish(client.approve(draftTicket.ticket_id, 'Other Analyst')))
      .rejects.toMatchObject({ name: 'AppError', code: 'already_approved' });
    expect(draftTicket.status).toBe('draft');
    expect(approvedTicket.approved_by).toBe('Demo Analyst');
  });

  it('allows only one of two concurrent approvals', async () => {
    const results = await finish(Promise.allSettled([
      client.approve(draftTicket.ticket_id, 'First'),
      client.approve(draftTicket.ticket_id, 'Second'),
    ]));
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected).toMatchObject({ reason: { code: 'already_approved' } });
  });

  it('does not share approval state across client instances', async () => {
    await finish(client.approve(draftTicket.ticket_id, 'Demo Analyst'));
    expect(await finish(createMockClient().approve(draftTicket.ticket_id, 'Demo Analyst')))
      .toEqual(approvedTicket);
  });

  it('rejects a blank analyst name without consuming the approval', async () => {
    await expect(finish(client.approve(draftTicket.ticket_id, '   ')))
      .rejects.toMatchObject({ code: 'validation_error' });
    expect(await finish(client.approve(draftTicket.ticket_id, 'Demo Analyst'))).toEqual(approvedTicket);
  });

  it('rejects unknown ticket IDs for approval and export', async () => {
    await expect(finish(client.approve('missing', 'Demo Analyst'))).rejects.toBeInstanceOf(AppError);
    await expect(finish(client.exportTicketMarkdown('missing'))).rejects.toMatchObject({ code: 'not_found' });
  });

  it('exports the current draft or approved fixture through ticketToMarkdown', async () => {
    expect(await finish(client.exportTicketMarkdown(draftTicket.ticket_id)))
      .toBe(ticketToMarkdown(draftTicket));
    await finish(client.approve(draftTicket.ticket_id, 'Demo Analyst'));
    expect(await finish(client.exportTicketMarkdown(draftTicket.ticket_id)))
      .toBe(ticketToMarkdown(approvedTicket));
  });

  it.each(['low_confidence', 'no_matching_sop'] as const)('creates a separate schema-shaped ticket for the %s demo run', async (key) => {
    const run = runFixtures[key];
    const ticket = await finish(client.createTicket(run.run_id));
    expect(ticket.run_id).toBe(run.run_id);
    expect(ticket.audit_ref).toBe(run.run_id);
    expect(ticket.timeline.some((event) => event.event === run.checklist.escalation_note)).toBe(true);
    expect(ticket.containment_actions.map((action) => action.action)).toEqual(run.checklist.steps.map((step) => step.action));
    expect(ticket.status).toBe('draft');
    const approved = await finish(client.approve(ticket.ticket_id, 'Demo Analyst'));
    expect(approved.status).toBe('approved');
    expect(approved.run_id).toBe(run.run_id);
    expect(approved.containment_actions.every((action) => action.status === 'approved')).toBe(true);
    expect(await finish(client.exportTicketMarkdown(ticket.ticket_id))).toBe(ticketToMarkdown(approved));
    await expect(finish(client.approve(ticket.ticket_id, 'Other'))).rejects.toMatchObject({ code: 'already_approved' });
  });

  it('rejects ticket generation for an unknown run instead of returning another run’s ticket', async () => {
    await expect(finish(client.createTicket('RUN-missing'))).rejects.toMatchObject({ code: 'not_found' });
  });

  it('searches exact fixture citations, ignoring case and respecting k', async () => {
    expect(await finish(client.search('  pb-ran-02  '))).toEqual([{
      playbook_id: 'PB-RAN', step_id: 'PB-RAN-02',
      text: runFixtures.grounded.checklist.steps[1]!.citation.source_text,
      score: runFixtures.grounded.checklist.retrieval_confidence,
    }]);
    expect(await finish(client.search('PB-RAN', 2))).toHaveLength(2);
    expect(await finish(client.search('does not exist'))).toEqual([]);
    expect(await finish(client.search(' '))).toEqual([]);
    await expect(finish(client.search('PB-RAN', 0))).rejects.toMatchObject({ code: 'validation_error' });
  });

  it('returns independent copies of auditRows', async () => {
    const result = await finish(client.audit(draftTicket.run_id));
    expect(result).toEqual(auditRows);
    result[0]!.details_json.changed = true;
    expect(await finish(client.audit(draftTicket.run_id))).toEqual(auditRows);
  });

  it('never returns the grounded audit rows for a different run', async () => {
    expect(await finish(client.audit(runFixtures.no_matching_sop.run_id))).toEqual([]);
    expect(await finish(client.audit(runFixtures.low_confidence.run_id))).toEqual([]);
  });

  it.each([0, 0.999999])('delays responses within 300–800 ms (random %s)', async (random) => {
    vi.spyOn(Math, 'random').mockReturnValue(random);
    const settled = vi.fn();
    const pending = client.health().then(settled);
    await vi.advanceTimersByTimeAsync(299);
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(random === 0 ? 1 : 500);
    expect(settled).toHaveBeenCalledTimes(random === 0 ? 1 : 0);
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(settled).toHaveBeenCalledOnce();
  });
});
