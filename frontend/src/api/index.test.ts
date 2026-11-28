import { afterEach, describe, expect, it, vi } from 'vitest';

describe('ApiClient environment switch', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it.each(['true', 'false', ''])('selects the correct client for VITE_USE_MOCK=%s', async (flag) => {
    vi.resetModules();
    vi.stubEnv('VITE_USE_MOCK', flag);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { apiClient } = await import('./index');
    const { mockClient } = await import('./mockClient');
    const { realClient } = await import('./client');
    expect(apiClient).toBe(flag === 'true' ? mockClient : realClient);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
