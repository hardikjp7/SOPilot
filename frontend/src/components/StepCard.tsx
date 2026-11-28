import { AlertTriangle, ShieldCheck, ShieldQuestion } from 'lucide-react';
import type { Step } from '../api/types';
import CitationChip from './CitationChip';
import type { OpenCitation } from './CitationChip';

export default function StepCard({ step, onOpenCitation }: { step: Step; onOpenCitation: OpenCitation }) {
  const VerificationIcon = step.verified ? ShieldCheck : ShieldQuestion;

  return (
    <li value={step.order} className="min-w-0 rounded-xl border border-outline/30 bg-canvas/40 p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-outline/30 bg-panel font-mono text-xs text-muted">{String(step.order).padStart(2, '0')}</span>
        <div className="min-w-0 flex-1">
          <h4 className="break-words text-sm font-semibold leading-6">{step.action}</h4>
          <div className="mt-2 flex flex-wrap gap-2 text-xs font-medium">
            <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 ${step.verified ? 'border-checklist-grounded/30 text-checklist-grounded' : 'border-checklist-low_confidence/40 text-checklist-low_confidence'}`}>
              <VerificationIcon size={12} aria-hidden="true" />{step.verified ? 'Verified' : 'Not verified'}
            </span>
            {step.support === 'partial' && <span className="inline-flex items-center gap-1.5 rounded-full border border-checklist-low_confidence/40 bg-checklist-low_confidence/5 px-2 py-0.5 text-checklist-low_confidence"><AlertTriangle size={12} aria-hidden="true" />Partial support</span>}
          </div>
        </div>
      </div>
      <div className="mt-4">
        <p className="mb-1 text-xs font-medium text-muted">Why this step</p>
        <p className="break-words text-sm leading-6 text-muted">{step.rationale}</p>
      </div>
      <div className="mt-4"><CitationChip citation={step.citation} onOpen={onOpenCitation} /></div>
    </li>
  );
}
