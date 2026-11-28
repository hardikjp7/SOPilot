// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { groundedRun } from '../mocks/fixtures';
import StepCard from './StepCard';

afterEach(cleanup);
const step = groundedRun.checklist.steps[0]!;

describe('StepCard', () => {
  it('passes the exact citation and originating button to the panel owner', () => {
    const onOpen = vi.fn();
    render(<ol><StepCard step={step} onOpenCitation={onOpen} /></ol>);
    const chip = screen.getByRole('button', { name: `View source for ${step.citation.step_id}` });
    expect(chip.getAttribute('aria-label')).toBe(chip.textContent?.trim());
    fireEvent.click(chip);
    expect(onOpen).toHaveBeenCalledExactlyOnceWith(step.citation, chip);
    expect(screen.getByText(step.citation.step_id).className).toContain('font-mono');
    expect(screen.queryByText('Partial support')).toBeNull();
  });

  it('renders verified and partial-support fields independently', () => {
    render(<ol><StepCard step={{ ...step, verified: false, support: 'partial' }} onOpenCitation={vi.fn()} /></ol>);
    expect(screen.getByText('Not verified')).toBeTruthy();
    expect(screen.getByText('Partial support')).toBeTruthy();
    expect(screen.queryByText('Verified')).toBeNull();
  });

  it('renders untrusted action and rationale strings as text', () => {
    const value = '<img src=x onerror=alert(1)>';
    const { container } = render(<ol><StepCard step={{ ...step, action: value, rationale: '<script>run()</script>' }} onOpenCitation={vi.fn()} /></ol>);
    expect(screen.getByRole('heading', { name: value })).toBeTruthy();
    expect(screen.getByText('<script>run()</script>')).toBeTruthy();
    expect(container.querySelector('img, script')).toBeNull();
  });
});
