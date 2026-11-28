import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError, errorMessages } from '../lib/errors';
import { approvedTicket, auditRows, draftTicket, groundedRun, samples } from '../mocks/fixtures';
import { createApiClient } from './client';
import type { ApiClient, ApiErrorCode } from './types';

const alert = { message: '<untrusted alert>' };
const cases: {
  name: string;
  call: (client: ApiClient) => Promise<unknown>;
  path: string;
  body?: unknown;
  response: unknown;
}[] = [
  { name: 'health', call: (c) => c.health(), path: '/health', response: { status: 'ok', mock: false, index_chunks: 8 } },
  { name: 'samples', call: (c) => c.samples(), path: '/samples', response: samples },
  { name: 'run', call: (c) => c.run(alert), path: '/run', body: { alert }, response: groundedRun },
  { name: 'parse', call: (c) => c.parse(alert), path: '/alerts/parse', body: { alert }, response: groundedRun.parsed },
  { name: 'checklist', call: (c) => c.checklist(groundedRun.parsed), path: '/checklist', body: { parsed: groundedRun.parsed }, response: groundedRun.checklist },
  { name: 'ticket', call: (c) => c.createTicket(groundedRun.run_id), path: '/ticket', body: { run_id: groundedRun.run_id }, response: draftTicket },
  { name: 'approve', call: (c) => c.approve(draftTicket.ticket_id, 'A & B'), path: '/approve', body: { ticket_id: draftTicket.ticket_id, analyst_name: 'A & B' }, response: approvedTicket },
  { name: 'search', call: (c) => c.search('a&b/? = #', 2), path: '/search?q=a%26b%2F%3F+%3D+%23&k=2', response: [] },
  { name: 'audit', call: (c) => c.audit('RUN &/'), path: '/audit?run_id=RUN+%26%2F', response: auditRows },
];

describe('real ApiClient', () => {
  const fetchMock = vi.fn<typeof fetch>();
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv('DEV', true);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it.each(cases)('uses the contract endpoint and request/response shape for $name', async (entry) => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(entry.response)));
    expect(await entry.call(createApiClient('https://service.example/api///'))).toEqual(entry.response);
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`https://service.example/api${entry.path}`);
    expect(options).toMatchObject({
      method: entry.body === undefined ? 'GET' : 'POST',
      headers: entry.body === undefined
        ? { Accept: 'application/json' }
        : { Accept: 'application/json', 'Content-Type': 'application/json' },
    });
    expect(options!.body).toBe(entry.body === undefined ? undefined : JSON.stringify(entry.body));
    expect(options!.signal).toBeInstanceOf(AbortSignal);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('uses VITE_API_BASE_URL when no explicit URL is supplied', async () => {
    vi.stubEnv('VITE_API_BASE_URL', '/api');
    fetchMock.mockResolvedValue(new Response('{"status":"ok","mock":false,"index_chunks":0}'));
    await createApiClient().health();
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/health');
  });

  it('exports Markdown as text and encodes the ticket ID as a single path segment', async () => {
    fetchMock.mockResolvedValue(new Response('# Incident\n\nTicket text'));
    expect(await createApiClient('/api').exportTicketMarkdown('INC/ ?#')).toBe('# Incident\n\nTicket text');
    expect(fetchMock).toHaveBeenCalledWith('/api/tickets/INC%2F%20%3F%23/export.md', expect.objectContaining({
      headers: { Accept: 'text/markdown' }, method: 'GET',
    }));
  });

  it('omits the optional k query parameter when unspecified', async () => {
    fetchMock.mockResolvedValue(new Response('[]'));
    await createApiClient('/api').search('PB-RAN');
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/search?q=PB-RAN');
  });

  const errors: [ApiErrorCode, number][] = [
    ['invalid_json', 422], ['payload_too_large', 413], ['validation_error', 422],
    ['not_found', 404], ['already_approved', 409], ['llm_unavailable', 503], ['internal_error', 500],
  ];
  it.each(errors)('normalizes HTTP errors for %s', async (code, status) => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      error: { code, message: 'RAW SERVER MESSAGE', details: { field: 'alert' } },
    }), { status }));
    await expect(createApiClient('/api').health()).rejects.toMatchObject({
      name: 'AppError', code, message: errorMessages[code], details: { field: 'alert' },
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('normalizes contract errors returned by the Markdown endpoint', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      error: { code: 'not_found', message: 'Missing' },
    }), { status: 404 }));
    await expect(createApiClient('/api').exportTicketMarkdown('missing'))
      .rejects.toMatchObject({ code: 'not_found' });
  });

  it('does not expose malformed or unknown server errors', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: { code: 'unknown', message: 'RAW BODY' } }), { status: 500 }));
    const result = await createApiClient('/api').health().catch((error: unknown) => error);
    expect(result).toBeInstanceOf(Error);
    expect(result).not.toBeInstanceOf(AppError);
    expect(result).toHaveProperty('message', 'The service returned an unexpected error. Please try again.');
  });

  it.each([200, 502])('handles unreadable response bodies (HTTP %s)', async (status) => {
    fetchMock.mockResolvedValue(new Response('<html>RAW BODY</html>', { status }));
    await expect(createApiClient('/api').health()).rejects.toThrow('unreadable response');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('handles connection failures without inventing an API error code', async () => {
    fetchMock.mockRejectedValue(new TypeError('RAW NETWORK DETAILS'));
    const result = await createApiClient('/api').health().catch((error: unknown) => error);
    expect(result).not.toBeInstanceOf(AppError);
    expect(result).toHaveProperty('message', 'Could not reach the service. Check your connection and try again.');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('aborts fetch at 35 seconds, without automatic retries', async () => {
    fetchMock.mockImplementation((_input, options) => new Promise((_resolve, reject) => {
      options!.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));
    const pending = createApiClient('/api').health();
    const rejection = expect(pending).rejects.toThrow('timed out after 35 seconds');
    await vi.advanceTimersByTimeAsync(34_999);
    expect(fetchMock.mock.calls[0]![1]!.signal!.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await rejection;
    expect(fetchMock.mock.calls[0]![1]!.signal!.aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps the 35 second deadline active while reading the response body', async () => {
    fetchMock.mockImplementation(async (_input, options) => {
      const response = new Response('{}');
      vi.spyOn(response, 'json').mockImplementation(() => new Promise((_resolve, reject) => {
        options!.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      }));
      return response;
    });
    const pending = createApiClient('/api').health();
    const rejection = expect(pending).rejects.toThrow('timed out after 35 seconds');
    await vi.advanceTimersByTimeAsync(35_000);
    await rejection;
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(cases)('checks development responses for $name before returning them to the UI', async (entry) => {
    fetchMock.mockResolvedValue(new Response('{}'));
    const result = await entry.call(createApiClient('/api')).catch((error: unknown) => error);
    expect(result).toBeInstanceOf(Error);
    expect(result).not.toBeInstanceOf(AppError);
    expect(result).toHaveProperty('message', expect.stringContaining('contract v2'));
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('[SOPilot contract v2]'), expect.objectContaining({ path: expect.stringContaining('$'), expected: expect.any(String), got: expect.any(String) }));
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reports malformed error envelopes before preserving safe error normalization', async () => {
    fetchMock.mockResolvedValue(new Response('{"error":{"code":"new_code","message":"RAW BODY"}}', { status: 500 }));
    await expect(createApiClient('/api').health()).rejects.toThrow('unexpected error');
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('$.error.code'), expect.objectContaining({ path: '$.error.code' }));
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain('RAW BODY');
  });

  it.each([200, 503])('warns at the root for non-JSON bodies (HTTP %s)', async (status) => {
    fetchMock.mockResolvedValue(new Response('RAW BODY', { status }));
    await expect(createApiClient('/api').health()).rejects.toThrow('unreadable response');
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('$'), { path: '$', expected: 'valid JSON response', got: 'invalid JSON' });
  });

  it('preserves request error handling if the diagnostic console throws', async () => {
    vi.mocked(console.warn).mockImplementation(() => { throw new Error('broken console'); });
    fetchMock.mockResolvedValue(new Response('{}'));
    await expect(createApiClient('/api').health()).rejects.toThrow('contract v2');
  });

  it('does not load validation or change response handling in production', async () => {
    vi.stubEnv('DEV', false);
    fetchMock.mockResolvedValue(new Response('{}'));
    expect(await createApiClient('/api').health()).toEqual({});
    expect(console.warn).not.toHaveBeenCalled();
  });
});
