// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { groundedRun, lowConfidenceRun, noMatchRun } from '../mocks/fixtures';
import ChecklistView from './ChecklistView';
import { activateButtonByKey, mockDialogMethods } from './dialog.test-utils';

describe('ChecklistView and citation interactions', () => {
  let restoreDialog: () => void;
  beforeEach(() => { restoreDialog = mockDialogMethods(); });
  afterEach(() => {
    cleanup();
    restoreDialog();
    document.body.style.overflow = '';
  });

  it('renders all six grounded steps in returned order, with rationale, verification and citations', () => {
    render(<ChecklistView checklist={groundedRun.checklist} />);
    const steps = within(screen.getByRole('list', { name: 'Containment steps' })).getAllByRole('listitem');
    expect(steps).toHaveLength(6);
    groundedRun.checklist.steps.forEach((step, index) => {
      expect(steps[index]!.getAttribute('value')).toBe(String(step.order));
      expect(within(steps[index]!).getByRole('heading', { name: step.action })).toBeTruthy();
      expect(within(steps[index]!).getByText(step.rationale)).toBeTruthy();
      expect(within(steps[index]!).getByText('Verified')).toBeTruthy();
      const chip = within(steps[index]!).getByRole('button', { name: `View source for ${step.citation.step_id}` });
      expect(chip.getAttribute('aria-haspopup')).toBe('dialog');
      expect(chip.className).toContain('min-h-11');
    });
    expect(screen.getByText('Partial support')).toBeTruthy();
    expect(within(steps[3]!).getByText('Partial support')).toBeTruthy();
    expect(screen.getByText('1 unsupported step removed by the verifier.')).toBeTruthy();
    expect(screen.getByRole('article', { name: 'CVE-2026-1001' })).toBeTruthy();
  });

  it('opens the exact citation by mouse, closes it, and restores focus to the originating chip', () => {
    render(<ChecklistView checklist={groundedRun.checklist} />);
    const trigger = screen.getByRole('button', { name: 'View source for PB-RAN-02' });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Playbook citation' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(within(dialog).getByText('PB-RAN')).toBeTruthy();
    expect(within(dialog).getByText('PB-RAN-02')).toBeTruthy();
    expect(within(dialog).getByRole('region', { name: 'Exact playbook source' }).textContent)
      .toBe(groundedRun.checklist.steps[1]!.citation.source_text);
    const close = within(dialog).getByRole('button', { name: 'Close citation panel' });
    expect(document.activeElement).toBe(close);
    fireEvent.click(close);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it.each(['Enter', ' '] as const)('supports %s activation, Escape dismissal and focus return', (key) => {
    render(<ChecklistView checklist={groundedRun.checklist} />);
    const trigger = screen.getByRole('button', { name: 'View source for PB-RAN-05' });
    activateButtonByKey(trigger, key);
    const dialog = screen.getByRole('dialog', { name: 'Playbook citation' });
    expect(within(dialog).getByText('PB-RAN-05')).toBeTruthy();
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('traps Tab and Shift+Tab between panel controls', () => {
    render(<ChecklistView checklist={groundedRun.checklist} />);
    fireEvent.click(screen.getByRole('button', { name: 'View source for PB-RAN-01' }));
    const dialog = screen.getByRole('dialog');
    const close = within(dialog).getByRole('button', { name: 'Close citation panel' });
    const source = within(dialog).getByRole('region', { name: 'Exact playbook source' });
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(source);
    fireEvent.keyDown(source, { key: 'Tab' });
    expect(document.activeElement).toBe(close);
  });

  it('handles native dialog cancellation and restores the previous page scroll policy', () => {
    document.body.style.overflow = 'scroll';
    render(<ChecklistView checklist={groundedRun.checklist} />);
    const trigger = screen.getByRole('button', { name: 'View source for PB-RAN-03' });
    fireEvent.click(trigger);
    expect(document.body.style.overflow).toBe('hidden');
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.body.style.overflow).toBe('scroll');
    expect(document.activeElement).toBe(trigger);
  });

  it('can open a different citation after closing the previous one', () => {
    render(<ChecklistView checklist={groundedRun.checklist} />);
    fireEvent.click(screen.getByRole('button', { name: 'View source for PB-RAN-01' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close citation panel' }));
    fireEvent.click(screen.getByRole('button', { name: 'View source for PB-RAN-09' }));
    expect(screen.getByRole('region', { name: 'Exact playbook source' }).textContent)
      .toBe(groundedRun.checklist.steps[5]!.citation.source_text);
  });

  it('cleans up an open panel when the checklist changes', () => {
    const { rerender } = render(<ChecklistView checklist={groundedRun.checklist} />);
    fireEvent.click(screen.getByRole('button', { name: 'View source for PB-RAN-01' }));
    rerender(<ChecklistView checklist={noMatchRun.checklist} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.body.style.overflow).toBe('');
    expect(screen.queryByRole('list', { name: 'Containment steps' })).toBeNull();
  });

  it('keeps low-confidence steps visible alongside the returned escalation note', () => {
    render(<ChecklistView checklist={lowConfidenceRun.checklist} />);
    expect(within(screen.getByRole('list', { name: 'Containment steps' })).getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText(lowConfidenceRun.checklist.escalation_note)).toBeTruthy();
    expect(screen.getByText('2 unsupported steps removed by the verifier.')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Related CVEs' })).toBeNull();
  });

  it('shows no-match guidance without inventing steps or citing a missing playbook', () => {
    render(<ChecklistView checklist={noMatchRun.checklist} />);
    expect(screen.getByText(noMatchRun.checklist.escalation_note)).toBeTruthy();
    expect(screen.getByText('No containment steps returned.')).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Containment steps' })).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByText(/unsupported steps? removed/)).toBeNull();
  });

  it('does not infer checklist status from the number of steps', () => {
    render(<ChecklistView checklist={{ ...groundedRun.checklist, steps: [], dropped_count: 0 }} />);
    expect(screen.getByText('Grounded')).toBeTruthy();
    expect(screen.getByText('No containment steps returned.')).toBeTruthy();
    expect(screen.queryByText(/unsupported steps? removed/)).toBeNull();
  });

  it('has loading, error and empty states without stale steps', () => {
    const { rerender } = render(<ChecklistView isLoading checklist={groundedRun.checklist} />);
    expect(screen.getByRole('status').textContent).toContain('Waiting for the verified checklist');
    expect(screen.queryByRole('list', { name: 'Containment steps' })).toBeNull();
    rerender(<ChecklistView isError checklist={groundedRun.checklist} />);
    expect(screen.getByRole('status').textContent).toContain('could not be loaded');
    expect(screen.queryByRole('list', { name: 'Containment steps' })).toBeNull();
    rerender(<ChecklistView />);
    expect(screen.getByText('Run an alert to see containment guidance.')).toBeTruthy();
  });
});
