// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { groundedRun, lowConfidenceRun, noMatchRun } from '../mocks/fixtures';
import ChecklistView from './ChecklistView';
import StatusBanner from './StatusBanner';

afterEach(cleanup);

describe('StatusBanner', () => {
  it('does not add an escalation banner to the grounded fixture', () => {
    const { status, escalation_note } = groundedRun.checklist;
    const { container } = render(<StatusBanner status={status} escalation_note={escalation_note} />);
    expect(container.innerHTML).toBe('');
  });

  it('shows the low-confidence fixture as an amber, polite status with an icon and the exact note', () => {
    const { status, escalation_note } = lowConfidenceRun.checklist;
    render(<StatusBanner status={status} escalation_note={escalation_note} />);
    const banner = screen.getByRole('status');
    expect(banner.getAttribute('aria-live')).toBe('polite');
    expect(banner.getAttribute('aria-atomic')).toBe('true');
    expect(banner.className).toContain('text-checklist-low_confidence');
    expect(within(banner).getByRole('heading', { name: 'Low confidence: manual review required' })).toBeTruthy();
    expect(within(banner).getByText(escalation_note)).toBeTruthy();
    expect(banner.querySelector('svg[aria-hidden="true"]')).toBeTruthy();
  });

  it('shows a strong no-match banner with a clear Escalate message', () => {
    const { status, escalation_note } = noMatchRun.checklist;
    render(<StatusBanner status={status} escalation_note={escalation_note} />);
    const banner = screen.getByRole('status');
    expect(banner.getAttribute('aria-live')).toBe('polite');
    expect(banner.className).toContain('border-l-4');
    expect(banner.className).toContain('text-checklist-no_matching_sop');
    expect(within(banner).getByRole('heading', { name: 'Escalate: no matching SOP' })).toBeTruthy();
    expect(within(banner).getByText(escalation_note)).toBeTruthy();
    expect(banner.querySelector('svg[aria-hidden="true"]')).toBeTruthy();
  });

  it('renders an untrusted escalation note as literal text', () => {
    const note = '<script>run()</script>\n  <img src=x onerror=alert(1)>';
    const { container } = render(<StatusBanner status="no_matching_sop" escalation_note={note} />);
    expect(screen.getByRole('status').querySelector('p')!.textContent).toBe(note);
    expect(container.querySelector('script, img')).toBeNull();
  });

  it('keeps the low-confidence fixture steps alongside the banner', () => {
    render(<ChecklistView checklist={lowConfidenceRun.checklist} />);
    expect(screen.getByRole('heading', { name: 'Low confidence: manual review required' })).toBeTruthy();
    expect(within(screen.getByRole('list', { name: 'Containment steps' })).getAllByRole('listitem')).toHaveLength(2);
    for (const step of lowConfidenceRun.checklist.steps) {
      expect(screen.getByRole('heading', { name: step.action })).toBeTruthy();
    }
  });

  it('hides the step list whenever API status is no_matching_sop', () => {
    // Even inconsistent data must never expose procedures in the no-match layout.
    render(<ChecklistView checklist={{ ...noMatchRun.checklist, steps: groundedRun.checklist.steps }} />);
    expect(screen.getByRole('heading', { name: 'Escalate: no matching SOP' })).toBeTruthy();
    expect(screen.getByText(noMatchRun.checklist.escalation_note)).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Containment steps' })).toBeNull();
    expect(screen.queryByRole('button', { name: /View source/ })).toBeNull();
  });
});
