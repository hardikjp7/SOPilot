// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../api';
import HealthBadge from './HealthBadge';

vi.mock('../api', () => ({ apiClient: { health: vi.fn() } }));
const clients: QueryClient[] = [];
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  clients.push(client);
  render(<QueryClientProvider client={client}><HealthBadge /></QueryClientProvider>);
}
beforeEach(() => vi.resetAllMocks());
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  vi.unstubAllEnvs();
});

describe('HealthBadge', () => {
  it('shows a neutral loading state before /health returns', () => {
    vi.mocked(apiClient.health).mockReturnValue(new Promise(() => {}));
    mount();
    expect(screen.getByRole('status', { name: 'Backend health' }).textContent).toBe('Connecting…');
    expect(screen.queryByText('Mock')).toBeNull();
    expect(screen.queryByText('Live')).toBeNull();
  });

  it.each([true, false])('renders the server mock=%s flag and index count', async (mock) => {
    vi.stubEnv('VITE_USE_MOCK', mock ? 'false' : 'true');
    vi.mocked(apiClient.health).mockResolvedValue({ status: 'ok', mock, index_chunks: 37 });
    mount();
    await screen.findByText(mock ? 'Mock' : 'Live');
    expect(screen.getByText('37 chunks')).toBeTruthy();
    expect(apiClient.health).toHaveBeenCalledOnce();
  });

  it('displays a zero chunk count without treating it as absent', async () => {
    vi.mocked(apiClient.health).mockResolvedValue({ status: 'ok', mock: true, index_chunks: 0 });
    mount();
    await screen.findByText('0 chunks');
  });

  it('shows a safe error and lets the user retry health', async () => {
    vi.mocked(apiClient.health).mockRejectedValueOnce(new Error('RAW BODY')).mockResolvedValueOnce({ status: 'ok', mock: true, index_chunks: 8 });
    mount();
    await screen.findByText('Service unavailable');
    expect(screen.queryByText('RAW BODY')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry health' }));
    await screen.findByText('Mock');
    expect(apiClient.health).toHaveBeenCalledTimes(2);
  });
});
