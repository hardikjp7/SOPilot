import { AlertTriangle, ShieldAlert } from 'lucide-react';
import type { Checklist } from '../api/types';

export default function StatusBanner({ status, escalation_note }: Pick<Checklist, 'status' | 'escalation_note'>) {
  if (status === 'grounded') return null;
  const noMatch = status === 'no_matching_sop';
  const Icon = noMatch ? ShieldAlert : AlertTriangle;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className={`rounded-xl border p-4 ${noMatch
        ? 'border-l-4 border-checklist-no_matching_sop/60 bg-checklist-no_matching_sop/10 text-checklist-no_matching_sop'
        : 'border-checklist-low_confidence/50 bg-checklist-low_confidence/5 text-checklist-low_confidence'}`}
    >
      <div className="flex items-start gap-3">
        <Icon size={20} aria-hidden="true" className="mt-0.5 shrink-0" />
        <div className="min-w-0">
          <h4 className="text-sm font-semibold leading-6">{noMatch ? 'Escalate: no matching SOP' : 'Low confidence: manual review required'}</h4>
          <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6">{escalation_note}</p>
        </div>
      </div>
    </div>
  );
}
