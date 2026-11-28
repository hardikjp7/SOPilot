// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { approvedTicket, draftTicket } from '../mocks/fixtures';
import ApprovalBar from './ApprovalBar';

afterEach(cleanup);

describe('ApprovalBar', () => {
  it('requires a non-empty name and blocks whitespace even on direct form submission', () => {
    const approve = vi.fn();
    render(<ApprovalBar ticket={draftTicket} onApprove={approve} />);
    const input = screen.getByRole('textbox', { name: /Analyst name/ });
    const button = screen.getByRole('button', { name: 'Approve ticket' }) as HTMLButtonElement;
    expect(input.hasAttribute('required')).toBe(true);
    expect(button.disabled).toBe(true);
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.blur(input);
    fireEvent.submit(screen.getByRole('form', { name: 'Approve incident ticket' }));
    expect(button.disabled).toBe(true);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('Enter an analyst name to approve this ticket.')).toBeTruthy();
    expect(approve).not.toHaveBeenCalled();
  });

  it('submits a trimmed analyst name', () => {
    const approve = vi.fn();
    render(<ApprovalBar ticket={draftTicket} onApprove={approve} />);
    fireEvent.change(screen.getByRole('textbox', { name: /Analyst name/ }), { target: { value: '  Demo Analyst  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Approve ticket' }));
    expect(approve).toHaveBeenCalledExactlyOnceWith('Demo Analyst');
  });

  it('disables editing and submission while approval is pending', () => {
    const approve = vi.fn();
    render(<ApprovalBar ticket={draftTicket} isApproving onApprove={approve} />);
    expect((screen.getByRole('textbox') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Approving…' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.submit(screen.getByRole('form', { name: 'Approve incident ticket' }));
    expect(approve).not.toHaveBeenCalled();
  });

  it('shows the API approver/time and removes editable controls after approval', () => {
    const { rerender } = render(<ApprovalBar ticket={draftTicket} onApprove={vi.fn()} />);
    rerender(<ApprovalBar ticket={approvedTicket} onApprove={vi.fn()} />);
    expect(screen.getByText('Approved · read-only')).toBeTruthy();
    expect(screen.getByText(approvedTicket.approved_by!)).toBeTruthy();
    expect(screen.getByText(approvedTicket.approved_at!)).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('form')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('status'));
  });

  it('locks an already-approved conflict without fabricating metadata on the draft', () => {
    render(<ApprovalBar ticket={draftTicket} approvalConflict onApprove={vi.fn()} />);
    expect(screen.getByText('Approval recorded · read-only snapshot')).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByText('Demo Analyst')).toBeNull();
  });
});
