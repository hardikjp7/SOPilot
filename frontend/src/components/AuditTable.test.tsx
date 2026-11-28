// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../api';
import { AppError } from '../lib/errors';
import { auditRows, groundedRun } from '../mocks/fixtures';
import type { AuditRow } from '../api/types';
import AuditTable from './AuditTable';

vi.mock('../api', () => ({ apiClient: { audit: vi.fn() } }));
const clients: QueryClient[] = [];
const runId = groundedRun.run_id;
function mount(id?: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  clients.push(client);
  const content = (value?: string) => <QueryClientProvider client={client}><AuditTable runId={value} /></QueryClientProvider>;
  const view = render(content(id));
  return { ...view, changeRun: (value: string) => view.rerender(content(value)) };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(apiClient.audit).mockResolvedValue(auditRows);
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
});

describe('AuditTable', () => {
  it('has a no-run empty state and never requests an unspecified run', () => {
    mount();
    expect(screen.getByRole('heading', { name: 'No run yet' })).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
    expect(apiClient.audit).not.toHaveBeenCalled();
  });

  it('shows loading until the audit request resolves', () => {
    vi.mocked(apiClient.audit).mockReturnValue(new Promise(() => {}));
    mount(runId);
    expect(screen.getByRole('status').textContent).toBe('Loading audit records…');
    expect((screen.getByRole('button', { name: 'Refresh audit' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('renders all returned rows with stage, time, nullable model and hashes', async () => {
    mount(runId);
    const table = await screen.findByRole('table', { name: `Audit records for ${runId}` });
    expect(apiClient.audit).toHaveBeenCalledExactlyOnceWith(runId);
    expect(within(table).getAllByRole('row')).toHaveLength(7);
    for (const row of auditRows) {
      const element = within(table).getByRole('rowheader', { name: row.stage }).closest('tr')!;
      expect(within(element).getByText(row.model ?? 'Not recorded')).toBeTruthy();
      expect(within(table).getByText(row.ts)).toBeTruthy();
    }
    expect(screen.getByTitle(auditRows[0]!.input_hash)).toBeTruthy();
    expect(screen.getByText('6 audit records returned.')).toBeTruthy();
    expect(screen.queryByRole('region', { name: /Formatted details/ })).toBeNull();
  });

  it('expands formatted JSON as text and exposes full hashes, then collapses the row', async () => {
    const inputHash = `sha256:${'a'.repeat(64)}`;
    const row = { ...auditRows[0]!, input_hash: inputHash, details_json: { result: '<img src=x onerror=alert(1)>', nested: { ok: true } } };
    vi.mocked(apiClient.audit).mockResolvedValueOnce([row]);
    const { container } = mount(runId);
    await screen.findByRole('table');
    expect(screen.getByTitle(inputHash).textContent).toBe('sha256:aaaaaaa…aaaaaa');
    const toggle = screen.getByRole('button', { name: 'Show details for parse audit row 1' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(document.getElementById(toggle.getAttribute('aria-controls')!)).toBeTruthy();
    const details = screen.getByRole('region', { name: 'Formatted details for parse audit row 1' });
    expect(details.textContent).toBe(JSON.stringify(row.details_json, null, 2));
    expect(screen.getByText(inputHash)).toBeTruthy();
    expect(container.querySelector('img')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Hide details for parse audit row 1' }));
    expect(screen.queryByRole('region', { name: 'Formatted details for parse audit row 1' })).toBeNull();
  });

  it('allows more than one audit row to be expanded', async () => {
    mount(runId);
    await screen.findByRole('table');
    fireEvent.click(screen.getByRole('button', { name: 'Show details for parse audit row 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Show details for verify audit row 4' }));
    expect(screen.getByRole('region', { name: 'Formatted details for parse audit row 1' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Formatted details for verify audit row 4' }).textContent)
      .toBe(JSON.stringify(auditRows[3]!.details_json, null, 2));
  });

  it('shows an empty returned audit with a manual refresh', async () => {
    vi.mocked(apiClient.audit).mockResolvedValue([]);
    mount(runId);
    await screen.findByRole('heading', { name: 'No audit records yet' });
    expect(screen.queryByRole('table')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh audit' }));
    await screen.findByRole('heading', { name: 'No audit records yet' });
    expect(apiClient.audit).toHaveBeenCalledTimes(2);
  });

  it('renders a safe error and retries the same audit request', async () => {
    vi.mocked(apiClient.audit).mockRejectedValueOnce(new AppError('llm_unavailable', { message: 'RAW BODY' }));
    const { container } = mount(runId);
    const retry = await screen.findByRole('button', { name: 'Retry audit' });
    expect(container.textContent).not.toContain('RAW BODY');
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'No audit records yet' })).toBeNull();
    fireEvent.click(retry);
    await screen.findByRole('table');
    expect(apiClient.audit).toHaveBeenNthCalledWith(2, runId);
  });

  it('refuses to display records belonging to another run', async () => {
    vi.mocked(apiClient.audit).mockResolvedValueOnce([{ ...auditRows[0]!, run_id: 'RUN-other' }]);
    mount(runId);
    await screen.findByRole('alert');
    expect(screen.getByText(/audit response contains records for another run/)).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('does not mix late responses from a previous run into the current audit', async () => {
    let resolveFirst!: (rows: AuditRow[]) => void;
    const second = [{ ...auditRows[0]!, run_id: 'RUN-second', model: 'second-model' }];
    vi.mocked(apiClient.audit).mockReturnValueOnce(new Promise((resolve) => { resolveFirst = resolve; })).mockResolvedValueOnce(second);
    const { changeRun } = mount(runId);
    changeRun('RUN-second');
    await screen.findByText('second-model');
    await act(async () => resolveFirst(auditRows));
    expect(screen.getByRole('table', { name: 'Audit records for RUN-second' })).toBeTruthy();
    expect(screen.queryByText('genailab-maas-gpt-5.4-mini')).toBeNull();
    expect(apiClient.audit).toHaveBeenNthCalledWith(1, runId);
    expect(apiClient.audit).toHaveBeenNthCalledWith(2, 'RUN-second');
  });
});
