import { useEffect, useId, useRef, useState } from 'react';
import { Check, LoaderCircle, LockKeyhole } from 'lucide-react';
import type { IncidentTicket } from '../api/types';

interface ApprovalBarProps {
  ticket: IncidentTicket;
  isApproving?: boolean;
  approvalConflict?: boolean;
  onApprove: (analystName: string) => void;
}

export default function ApprovalBar({ ticket, isApproving = false, approvalConflict = false, onApprove }: ApprovalBarProps) {
  const [name, setName] = useState('');
  const [touched, setTouched] = useState(false);
  const id = useId();
  const summary = useRef<HTMLDivElement>(null);
  const approved = ticket.status === 'approved';

  useEffect(() => {
    if (approved || approvalConflict) summary.current?.focus({ preventScroll: true });
  }, [approved, approvalConflict]);

  if (approved || approvalConflict) {
    return (
      <div ref={summary} tabIndex={-1} role="status" aria-live="polite" className="focus-target rounded-xl border border-outline/40 bg-canvas/50 p-4">
        <p className="flex items-center gap-2 text-sm font-semibold"><LockKeyhole size={16} aria-hidden="true" />{approved ? 'Approved · read-only' : 'Approval recorded · read-only snapshot'}</p>
        {approved ? <dl className="mt-3 space-y-2 text-sm"><div><dt className="text-xs text-muted">Approved by</dt><dd className="mt-1 break-words">{ticket.approved_by ?? 'Not provided'}</dd></div><div><dt className="text-xs text-muted">Approved at</dt><dd className="mt-1 break-words font-mono text-xs">{ticket.approved_at ?? 'Not provided'}</dd></div></dl>
          : <p className="mt-2 text-xs leading-5 text-muted">Approver and approval time are not available in this draft snapshot.</p>}
      </div>
    );
  }

  return (
    <form aria-label="Approve incident ticket" className="rounded-xl border border-outline/40 bg-canvas/50 p-4" onSubmit={(event) => {
      event.preventDefault();
      setTouched(true);
      if (name.trim() && !isApproving) onApprove(name.trim());
    }}>
      <p className="mb-2 text-sm font-semibold">Analyst approval</p>
      <p className="mb-4 text-xs leading-5 text-muted">Review the ticket and cited recommendations. Approval makes the ticket read-only.</p>
      <label htmlFor={`${id}-name`} className="mb-2 block text-sm font-medium">Analyst name <span className="text-xs text-muted">(required)</span></label>
      <div className="flex flex-col gap-3 sm:flex-row">
        <input id={`${id}-name`} value={name} required autoComplete="name" disabled={isApproving}
          onChange={(event) => setName(event.target.value)} onBlur={() => setTouched(true)}
          aria-invalid={touched && !name.trim()} aria-describedby={`${id}-feedback`}
          className="control min-h-11 min-w-0 flex-1 px-3 text-sm" />
        <button type="submit" disabled={!name.trim() || isApproving} className="button-primary justify-center text-sm">
          {isApproving ? <LoaderCircle size={15} className="motion-safe:animate-spin" aria-hidden="true" /> : <Check size={15} aria-hidden="true" />}
          {isApproving ? 'Approving…' : 'Approve ticket'}
        </button>
      </div>
      <p id={`${id}-feedback`} role="status" aria-live="polite" className="mt-2 min-h-5 text-xs leading-5 text-muted">{touched && !name.trim() ? 'Enter an analyst name to approve this ticket.' : isApproving ? 'Recording approval…' : ''}</p>
    </form>
  );
}
