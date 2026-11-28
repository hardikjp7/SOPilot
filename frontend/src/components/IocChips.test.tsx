// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Iocs } from '../api/types';
import { groundedRun } from '../mocks/fixtures';
import IocChips from './IocChips';

const allIocs: Iocs = {
  ips: ['198.51.100.23'], domains: ['example.test'], urls: ['https://example.test/path'],
  hashes: ['a'.repeat(64)], emails: ['analyst@example.test'], users: ['svc_backup'],
  cve_ids: ['CVE-2026-1001'], resources: ['FIN-WS-014'],
};
const descriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
const writeText = vi.fn<(value: string) => Promise<void>>();

beforeEach(() => {
  writeText.mockReset().mockResolvedValue();
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
});
afterEach(() => {
  cleanup();
  if (descriptor) Object.defineProperty(navigator, 'clipboard', descriptor);
  else Reflect.deleteProperty(navigator, 'clipboard');
  vi.useRealTimers();
});

describe('IocChips', () => {
  it('groups all eight indicator types and renders monospace copy controls without links', () => {
    render(<IocChips iocs={allIocs} />);
    for (const label of ['IP addresses', 'Domains', 'URLs', 'Hashes', 'Emails', 'Users', 'CVE IDs', 'Resources']) {
      expect(screen.getByRole('group', { name: label })).toBeTruthy();
    }
    for (const value of Object.values(allIocs).flat()) {
      expect(screen.getByRole('button', { name: `Copy ${value}` })).toBeTruthy();
      expect(screen.getByText(value).className).toContain('font-mono');
    }
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('hides empty groups rather than showing empty headings', () => {
    render(<IocChips iocs={groundedRun.parsed.iocs} />);
    expect(screen.queryByRole('group', { name: 'Domains' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Emails' })).toBeNull();
    expect(within(screen.getByRole('group', { name: 'Users' })).getByText('svc_backup')).toBeTruthy();
  });

  it('copies the exact value and announces success', async () => {
    render(<IocChips iocs={allIocs} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy https://example.test/path' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Copied https://example.test/path to clipboard.'));
    expect(writeText).toHaveBeenCalledExactlyOnceWith('https://example.test/path');
  });

  it('clears copy feedback after two seconds and cleans up the timer', async () => {
    vi.useFakeTimers();
    const { unmount } = render(<IocChips iocs={allIocs} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy svc_backup' })); });
    expect(screen.getByRole('status').textContent).toContain('Copied svc_backup');
    act(() => vi.advanceTimersByTime(2000));
    expect(screen.getByRole('status').textContent).toBe('');
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps indicators readable and announces a clipboard failure', async () => {
    writeText.mockRejectedValue(new Error('Permission denied'));
    render(<IocChips iocs={allIocs} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy svc_backup' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Could not copy.'));
    expect(screen.getByText('svc_backup')).toBeTruthy();
    expect(screen.queryByText(/Permission denied/)).toBeNull();
  });

  it('handles a browser without clipboard access', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    render(<IocChips iocs={allIocs} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy svc_backup' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('copy it manually'));
  });

  it('does not let a slow previous copy overwrite newer feedback', async () => {
    let resolveFirst!: () => void;
    writeText.mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }));
    render(<IocChips iocs={allIocs} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy svc_backup' }));
    fireEvent.click(screen.getByRole('button', { name: 'Copy FIN-WS-014' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Copied FIN-WS-014'));
    await act(async () => resolveFirst());
    expect(screen.getByRole('status').textContent).toBe('Copied FIN-WS-014 to clipboard.');
  });
});
