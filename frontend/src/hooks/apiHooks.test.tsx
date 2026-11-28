import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../api';
import { AppError } from '../lib/errors';
import { approvedTicket, auditRows, draftTicket, groundedRun } from '../mocks/fixtures';
import { useAudit } from './useAudit';
import { useHealth } from './useHealth';
import { useRun } from './useRun';
import { useApproveTicket, useTicket } from './useTicket';

vi.mock('../api', () => ({
  apiClient: {
    run: vi.fn(), createTicket: vi.fn(), approve: vi.fn(), audit: vi.fn(), health: vi.fn(),
  },
}));

const clients: QueryClient[] = [];

function newQueryClient() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      // Verify that the hooks override a provider's automatic mutation retries.
      mutations: { retry: 2, gcTime: Infinity },
    },
  });
  clients.push(client);
  return client;
}

// A server render initializes the real TanStack observers without a DOM emulator.
// Drive their public refetch/mutateAsync functions and inspect the query cache.
function renderHook<T>(hook: () => T, client = newQueryClient()) {
  let result: T | undefined;
  function Probe() {
    result = hook();
    return null;
  }
  renderToStaticMarkup(<QueryClientProvider client={client}><Probe /></QueryClientProvider>);
  return { result: result as T, client };
}

describe('API query hooks', () => {
  beforeEach(() => vi.resetAllMocks());
  afterEach(() => {
    clients.splice(0).forEach((client) => client.clear());
    vi.restoreAllMocks();
  });

  it('passes alert data through useRun and returns the API response', async () => {
    vi.mocked(apiClient.run).mockResolvedValue(groundedRun);
    const { result } = renderHook(useRun);
    const alert = { event: 'ransomware' };
    expect(await result.mutateAsync(alert)).toEqual(groundedRun);
    expect(apiClient.run).toHaveBeenCalledExactlyOnceWith(alert);
  });

  it('creates a ticket, caches the returned draft and invalidates the run audit', async () => {
    vi.mocked(apiClient.createTicket).mockResolvedValue(draftTicket);
    const { result, client } = renderHook(useTicket);
    client.setQueryData(['audit', draftTicket.run_id], auditRows);
    expect(await result.mutateAsync(draftTicket.run_id)).toEqual(draftTicket);
    expect(apiClient.createTicket).toHaveBeenCalledExactlyOnceWith(draftTicket.run_id);
    expect(client.getQueryData(['ticket', draftTicket.run_id])).toEqual(draftTicket);
    expect(client.getQueryState(['audit', draftTicket.run_id])!.isInvalidated).toBe(true);
  });

  it('replaces the cached draft with the approved response and refreshes audit data', async () => {
    vi.mocked(apiClient.approve).mockResolvedValue(approvedTicket);
    const { result, client } = renderHook(useApproveTicket);
    client.setQueryData(['ticket', draftTicket.run_id], draftTicket);
    client.setQueryData(['audit', draftTicket.run_id], auditRows);
    expect(await result.mutateAsync({ ticketId: draftTicket.ticket_id, analystName: 'Demo Analyst' }))
      .toEqual(approvedTicket);
    expect(apiClient.approve).toHaveBeenCalledExactlyOnceWith(draftTicket.ticket_id, 'Demo Analyst');
    expect(client.getQueryData(['ticket', draftTicket.run_id])).toEqual(approvedTicket);
    expect(client.getQueryState(['audit', draftTicket.run_id])!.isInvalidated).toBe(true);
  });

  it('surfaces already_approved without retrying or changing cached data', async () => {
    const error = new AppError('already_approved');
    vi.mocked(apiClient.approve).mockRejectedValue(error);
    const { result, client } = renderHook(useApproveTicket);
    client.setQueryData(['ticket', approvedTicket.run_id], approvedTicket);
    await expect(result.mutateAsync({ ticketId: approvedTicket.ticket_id, analystName: 'Demo Analyst' }))
      .rejects.toBe(error);
    expect(apiClient.approve).toHaveBeenCalledOnce();
    expect(client.getQueryData(['ticket', approvedTicket.run_id])).toEqual(approvedTicket);
  });

  it('does not request audit data before a run exists', () => {
    const { result } = renderHook(() => useAudit());
    expect(result.fetchStatus).toBe('idle');
    expect(apiClient.audit).not.toHaveBeenCalled();
  });

  it('keeps audit data separate for different runs', async () => {
    const firstRows = [{ ...auditRows[0]!, run_id: 'RUN-first' }];
    const secondRows = [{ ...auditRows[0]!, run_id: 'RUN-second' }];
    vi.mocked(apiClient.audit).mockResolvedValueOnce(firstRows).mockResolvedValueOnce(secondRows);
    const client = newQueryClient();
    const first = renderHook(() => useAudit('RUN-first'), client);
    const second = renderHook(() => useAudit('RUN-second'), client);
    await first.result.refetch();
    await second.result.refetch();
    expect(apiClient.audit).toHaveBeenNthCalledWith(1, 'RUN-first');
    expect(apiClient.audit).toHaveBeenNthCalledWith(2, 'RUN-second');
    expect(client.getQueryData(['audit', 'RUN-first'])).toEqual(firstRows);
    expect(client.getQueryData(['audit', 'RUN-second'])).toEqual(secondRows);
  });

  it('returns API health without inferring mock/live mode', async () => {
    const health = { status: 'ok', mock: false, index_chunks: 42 } as const;
    vi.mocked(apiClient.health).mockResolvedValue(health);
    const { result, client } = renderHook(useHealth);
    const response = await result.refetch();
    expect(response.data).toEqual(health);
    expect(client.getQueryData(['health'])).toEqual(health);
    expect(apiClient.health).toHaveBeenCalledOnce();
  });

  it('preserves a typed query failure for the UI', async () => {
    const error = new AppError('llm_unavailable');
    vi.mocked(apiClient.health).mockRejectedValue(error);
    const { result, client } = renderHook(useHealth);
    await expect(result.refetch({ throwOnError: true })).rejects.toBe(error);
    expect(client.getQueryState(['health'])).toMatchObject({ status: 'error', error });
    expect(apiClient.health).toHaveBeenCalledOnce();
  });
});
