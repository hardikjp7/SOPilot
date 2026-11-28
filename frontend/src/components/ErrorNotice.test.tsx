// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiErrorCode } from '../api/types';
import { AppError } from '../lib/errors';
import ErrorNotice from './ErrorNotice';

afterEach(cleanup);

const cases: [ApiErrorCode, string][] = [
  ['invalid_json', 'The alert is not valid JSON. Check the input and try again.'],
  ['payload_too_large', 'The alert is too large. Reduce it to 200 KB or less.'],
  ['validation_error', 'Some information is missing or invalid. Check your input and try again.'],
  ['not_found', 'The requested item could not be found. Check your selection and try again.'],
  ['already_approved', 'This ticket has already been approved and is read-only.'],
  ['llm_unavailable', 'The analysis service is temporarily unavailable. Please retry.'],
  ['internal_error', 'The service encountered an internal error. Please retry.'],
];

describe('ErrorNotice', () => {
  it.each(cases)('renders a friendly message for %s without exposing raw messages or details', (code, message) => {
    const error = new AppError(code, { debug: 'RAW SECRET BODY' });
    error.message = '<script>RAW SERVER MESSAGE</script>';
    const { container } = render(<ErrorNotice error={error} onRetry={vi.fn()} />);
    const notice = screen.getByRole(code === 'already_approved' ? 'status' : 'alert');
    expect(notice.getAttribute('aria-live')).toBe(code === 'already_approved' ? 'polite' : 'assertive');
    expect(screen.getByText(message)).toBeTruthy();
    expect(notice.querySelector('svg[aria-hidden="true"]')).toBeTruthy();
    expect(container.textContent).not.toContain('RAW');
    expect(container.querySelector('script')).toBeNull();
  });

  it.each(cases)('maps a raw %s error envelope without displaying its body', (code, message) => {
    const { container } = render(<ErrorNotice error={{ error: { code, message: 'RAW SERVER MESSAGE', details: { debug: 'RAW DETAILS' } } }} />);
    expect(screen.getByText(message)).toBeTruthy();
    expect(container.textContent).not.toContain('RAW');
  });

  it.each(['llm_unavailable', 'internal_error'] as const)('offers manual Retry for %s and only invokes it when clicked', (code) => {
    const retry = vi.fn();
    render(<ErrorNotice error={new AppError(code)} onRetry={retry} />);
    expect(retry).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry analysis' }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it.each(['invalid_json', 'payload_too_large'] satisfies ApiErrorCode[])('points %s back to the alert input instead of retrying an unchanged request', (code) => {
    const edit = vi.fn();
    const retry = vi.fn();
    render(<ErrorNotice error={new AppError(code)} onEditInput={edit} onRetry={retry} />);
    expect(screen.getByText('Review the Alert JSON input, then run the analysis again.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Review alert input' }));
    expect(edit).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: 'Retry analysis' })).toBeNull();
    expect(retry).not.toHaveBeenCalled();
  });

  it('treats already_approved as a read-only notice without an approval retry', () => {
    render(<ErrorNotice error={new AppError('already_approved')} onRetry={vi.fn()} />);
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Ticket already approved' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it.each([
    new Error('RAW NETWORK RESPONSE: secret'),
    '<html>RAW BODY</html>',
    { error: { code: 'unknown', message: 'RAW MESSAGE', details: 'RAW DETAILS' } },
    { error: { code: 'constructor', message: 'RAW MESSAGE' } },
    null,
  ])('uses a generic fallback for unrecognized failures without leaking data: %#', (error) => {
    const { container } = render(<ErrorNotice error={error} onRetry={vi.fn()} />);
    expect(screen.getByText('The request could not be completed. Check your connection and try again.')).toBeTruthy();
    expect(container.textContent).not.toMatch(/RAW|secret|<html>/);
    expect(screen.getByRole('button', { name: 'Retry analysis' })).toBeTruthy();
  });
});
