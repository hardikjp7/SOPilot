// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { groundedRun, noMatchRun } from '../mocks/fixtures';
import PipelineStepper from './PipelineStepper';

describe('PipelineStepper', () => {
  const listeners = new Set<() => void>();
  const media = {
    matches: false,
    addEventListener: vi.fn((_event: string, listener: () => void) => listeners.add(listener)),
    removeEventListener: vi.fn((_event: string, listener: () => void) => listeners.delete(listener)),
  };
  const current = () => screen.getAllByRole('listitem').find((item) => item.getAttribute('aria-current') === 'step');

  beforeEach(() => {
    vi.useFakeTimers();
    media.matches = false;
    listeners.clear();
    vi.clearAllMocks();
    vi.stubGlobal('matchMedia', vi.fn(() => media));
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('shows all four stages in an idle state', () => {
    render(<PipelineStepper status="idle" />);
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
    for (const label of ['Parse', 'Retrieve', 'Generate', 'Verify']) expect(screen.getByText(label)).toBeTruthy();
    expect(screen.getAllByText('Not started')).toHaveLength(4);
    expect(current()).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('simulates one second per stage and holds at Verify for long requests', () => {
    render(<PipelineStepper status="pending" />);
    expect(within(current()!).getByText('Parse')).toBeTruthy();
    for (const label of ['Retrieve', 'Generate', 'Verify']) {
      act(() => vi.advanceTimersByTime(1000));
      expect(within(current()!).getByText(label)).toBeTruthy();
    }
    act(() => vi.advanceTimersByTime(30_000));
    expect(within(current()!).getByText('Verify')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('Verify (simulated)');
    expect(screen.queryByText(/Run complete/)).toBeNull();
    expect(screen.queryByText(/ms$/)).toBeNull();
    expect(screen.getAllByText('Awaiting response')).toHaveLength(3);
  });

  it('snaps to actual API timings even when the response arrives before the first simulated advance', () => {
    const { rerender } = render(<PipelineStepper status="pending" />);
    act(() => vi.advanceTimersByTime(200));
    rerender(<PipelineStepper status="success" timings={groundedRun.timings_ms} />);
    for (const value of ['1,280 ms', '210 ms', '2,950 ms', '1,420 ms', 'Total 5,860 ms']) {
      expect(screen.getByText(value)).toBeTruthy();
    }
    expect(screen.getByRole('status').textContent).toContain('Reported timings');
    expect(current()).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('displays reported zero timings without inventing skipped-stage decisions', () => {
    render(<PipelineStepper status="success" timings={noMatchRun.timings_ms} />);
    expect(screen.getAllByText('0 ms')).toHaveLength(2);
    expect(screen.getByText('Total 1,210 ms')).toBeTruthy();
    expect(screen.queryByText(/skipped/i)).toBeNull();
  });

  it('marks the run as failed without assigning failure or completion to simulated stages', () => {
    const { rerender } = render(<PipelineStepper status="pending" />);
    act(() => vi.advanceTimersByTime(2000));
    rerender(<PipelineStepper status="error" />);
    expect(screen.getByRole('status').textContent).toBe('Analysis failed. The service did not report which stage failed.');
    expect(screen.getAllByText('Not confirmed')).toHaveLength(4);
    expect(current()).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
    act(() => vi.advanceTimersByTime(5000));
    expect(current()).toBeUndefined();
  });

  it('restarts simulated progress from Parse on a retry', () => {
    const { rerender } = render(<PipelineStepper status="pending" />);
    act(() => vi.advanceTimersByTime(3000));
    rerender(<PipelineStepper status="error" />);
    rerender(<PipelineStepper status="pending" />);
    expect(within(current()!).getByText('Parse')).toBeTruthy();
    act(() => vi.advanceTimersByTime(1000));
    expect(within(current()!).getByText('Retrieve')).toBeTruthy();
  });

  it('keeps progress static when reduced motion is preferred', () => {
    media.matches = true;
    const { container } = render(<PipelineStepper status="pending" />);
    expect(vi.getTimerCount()).toBe(0);
    act(() => vi.advanceTimersByTime(30_000));
    expect(current()).toBeUndefined();
    expect(screen.getByRole('status').textContent).toBe('Analysis in progress. Awaiting server response.');
    expect(container.querySelector('.motion-safe\\:animate-spin')).toBeNull();
  });

  it('responds to motion-preference changes and cleans up on unmount', () => {
    const { unmount } = render(<PipelineStepper status="pending" />);
    expect(vi.getTimerCount()).toBe(1);
    act(() => { media.matches = true; listeners.forEach((listener) => listener()); });
    expect(current()).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
    act(() => { media.matches = false; listeners.forEach((listener) => listener()); });
    expect(current()).toBeTruthy();
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    expect(listeners.size).toBe(0);
  });
});
