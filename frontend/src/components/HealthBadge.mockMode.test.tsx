// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

vi.hoisted(() => { vi.stubEnv('VITE_USE_MOCK', 'true'); });
import { apiClient } from '../api';
import { mockClient } from '../api/mockClient';
import HealthBadge from './HealthBadge';

let client: QueryClient;
afterEach(() => { cleanup(); client.clear(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it('shows Mock with VITE_USE_MOCK=true through the actual mock client and /health method', async () => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  expect(apiClient).toBe(mockClient);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  render(<QueryClientProvider client={client}><HealthBadge /></QueryClientProvider>);
  await screen.findByText('Mock', {}, { timeout: 2000 });
  expect(screen.getByText('8 chunks')).toBeTruthy();
  expect(fetch).not.toHaveBeenCalled();
});
