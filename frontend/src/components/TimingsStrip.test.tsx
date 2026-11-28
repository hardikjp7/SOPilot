// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { groundedRun, noMatchRun } from '../mocks/fixtures';
import TimingsStrip from './TimingsStrip';

afterEach(cleanup);
describe('TimingsStrip', () => {
  it('has an empty state before a run returns timings', () => {
    render(<TimingsStrip />);
    expect(screen.getByRole('region', { name: 'Run timings' })).toBeTruthy();
    expect(screen.getByText('No timings yet. Run an alert to see the reported durations.')).toBeTruthy();
    expect(screen.queryByText('Total')).toBeNull();
  });

  it('shows all four reported stages and the API total in milliseconds', () => {
    render(<TimingsStrip timings={groundedRun.timings_ms} />);
    for (const [label, value] of [['Parse', '1,280 ms'], ['Retrieve', '210 ms'], ['Generate', '2,950 ms'], ['Verify', '1,420 ms'], ['Total', '5,860 ms']]) {
      expect(screen.getByText(label!).nextElementSibling!.textContent).toBe(value);
    }
  });

  it('preserves zero values instead of inferring skipped stages', () => {
    render(<TimingsStrip timings={noMatchRun.timings_ms} />);
    expect(screen.getAllByText('0 ms')).toHaveLength(2);
    expect(screen.queryByText(/skipped/i)).toBeNull();
  });

  it('does not recompute total from the stage timings', () => {
    render(<TimingsStrip timings={{ ...groundedRun.timings_ms, total: 9 }} />);
    expect(screen.getByText('Total').nextElementSibling!.textContent).toBe('9 ms');
  });
});
