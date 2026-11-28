// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.hoisted(() => { vi.stubEnv('VITE_USE_MOCK', 'false'); vi.stubEnv('DEV', true); });
import App from '../App';
import run from '../mocks/golden/run-ransomware.json';
import health from '../mocks/golden/health.json';
import samples from '../mocks/golden/samples.json';

const fetchMock = vi.fn<typeof fetch>();
let client: QueryClient;
beforeEach(() => {
  localStorage.clear();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  let attempts = 0;
  fetchMock.mockImplementation(async (input) => {
    const path = new URL(String(input)).pathname;
    const body = path.endsWith('/health') ? health : path.endsWith('/samples') ? samples
      : ++attempts === 1 ? { ...run, parsed: { ...run.parsed, iocs: null } } : run;
    return new Response(JSON.stringify(body));
  });
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { gcTime: Infinity } } });
});
afterEach(() => { cleanup(); client.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('keeps malformed real responses out of React, shows a safe error, and recovers on retry', async () => {
  render(<QueryClientProvider client={client}><App /></QueryClientProvider>);
  await screen.findByText('Live');
  fireEvent.change(screen.getByRole('textbox', { name: 'Alert JSON' }), { target: { value: '{}' } });
  fireEvent.click(screen.getByRole('button', { name: 'Run analysis' }));
  await screen.findByRole('heading', { name: 'Request unavailable' });
  expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('$.parsed.iocs'), { path: '$.parsed.iocs', expected: 'object', got: 'null' });
  expect(screen.queryByRole('list', { name: 'Containment steps' })).toBeNull();
  expect(screen.getByRole('textbox', { name: 'Alert JSON' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Retry analysis' }));
  await screen.findByText(run.parsed.summary);
  await waitFor(() => expect(screen.getByRole('list', { name: 'Containment steps' })).toBeTruthy());
});
