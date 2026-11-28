import { normalizeApiError } from '../lib/errors';
import type { ResponseContract } from '../lib/contractCheck';
import type {
  ApiClient,
  AuditRow,
  Checklist,
  HealthResponse,
  IncidentTicket,
  ParsedAlert,
  RunResponse,
  SampleAlert,
  SearchHit,
} from './types';

const REQUEST_TIMEOUT_MS = 35_000;

async function matchesDevelopmentContract(contract: ResponseContract, payload: unknown, invalidJson = false): Promise<boolean> {
  if (import.meta.env.DEV) {
    try {
      const { checkContract, reportContractIssues } = await import('../lib/contractCheck');
      if (invalidJson) {
        reportContractIssues(contract, [{ path: '$', expected: 'valid JSON response', got: 'invalid JSON' }]);
        return false;
      }
      return checkContract(contract, payload).length === 0;
    } catch {
      try { console.warn('[SOPilot contract v2] $: expected available response checker; got unavailable checker'); } catch { /* Console may be disabled. */ }
      return false;
    }
  }
  return true;
}

export function createApiClient(
  baseUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api',
): ApiClient {
  const base = baseUrl.replace(/\/+$/, '');

  async function request<T>(contract: keyof ApiClient, path: string, body?: unknown): Promise<T> {
    const markdown = contract === 'exportTicketMarkdown';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const readError = () => new Error(
      controller.signal.aborted
        ? 'The request timed out after 35 seconds. Please try again.'
        : 'The service returned an unreadable response. Please try again.',
    );

    try {
      let response: Response;
      try {
        response = await fetch(`${base}${path}`, {
          method: body === undefined ? 'GET' : 'POST',
          headers: {
            Accept: markdown ? 'text/markdown' : 'application/json',
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal: controller.signal,
        });
      } catch {
        throw new Error(
          controller.signal.aborted
            ? 'The request timed out after 35 seconds. Please try again.'
            : 'Could not reach the service. Check your connection and try again.',
        );
      }

      if (!response.ok) {
        let payload: unknown;
        try {
          payload = await response.json();
        } catch (error) {
          if (error instanceof SyntaxError) await matchesDevelopmentContract('error', undefined, true);
          throw readError();
        }
        await matchesDevelopmentContract('error', payload);
        throw normalizeApiError(payload)
          ?? new Error('The service returned an unexpected error. Please try again.');
      }

      let payload: unknown;
      try {
        payload = markdown ? await response.text() : await response.json();
      } catch (error) {
        if (error instanceof SyntaxError) await matchesDevelopmentContract(contract, undefined, true);
        throw readError();
      }
      if (!await matchesDevelopmentContract(contract, payload)) {
        // Use the existing generic error UI; never pass unsafe shapes to React.
        throw new Error('The service response did not match contract v2. Check the development console.');
      }
      return payload as T;
    } finally {
      // Keep the deadline active until the response body has also been read.
      clearTimeout(timer);
    }
  }

  return {
    health: () => request<HealthResponse>('health', '/health'),
    samples: () => request<SampleAlert[]>('samples', '/samples'),
    run: (alert) => request<RunResponse>('run', '/run', { alert }),
    parse: (alert) => request<ParsedAlert>('parse', '/alerts/parse', { alert }),
    checklist: (parsed) => request<Checklist>('checklist', '/checklist', { parsed }),
    createTicket: (runId) => request<IncidentTicket>('createTicket', '/ticket', { run_id: runId }),
    approve: (ticketId, analystName) => request<IncidentTicket>('approve', '/approve', {
      ticket_id: ticketId,
      analyst_name: analystName,
    }),
    exportTicketMarkdown: (ticketId) => request<string>(
      'exportTicketMarkdown', `/tickets/${encodeURIComponent(ticketId)}/export.md`,
    ),
    search: (q, k) => {
      const params = new URLSearchParams({ q });
      if (k !== undefined) params.set('k', String(k));
      return request<SearchHit[]>('search', `/search?${params}`);
    },
    audit: (runId) => request<AuditRow[]>('audit', `/audit?${new URLSearchParams({ run_id: runId })}`),
  };
}

export const realClient = createApiClient();
