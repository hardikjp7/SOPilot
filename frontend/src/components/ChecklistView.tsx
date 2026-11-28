import { useCallback, useEffect, useId, useState } from 'react';
import { AlertTriangle, Check, CircleX, Filter } from 'lucide-react';
import type { Checklist, Citation, ChecklistStatus } from '../api/types';
import CitationPanel from './CitationPanel';
import CveCard from './CveCard';
import StepCard from './StepCard';
import StatusBanner from './StatusBanner';
import SkeletonLines from './SkeletonLines';

interface ChecklistViewProps {
  checklist?: Checklist;
  isLoading?: boolean;
  isError?: boolean;
}

const statusLabels: Record<ChecklistStatus, { label: string; style: string }> = {
  grounded: { label: 'Grounded', style: 'border-checklist-grounded/40 bg-checklist-grounded/5 text-checklist-grounded' },
  low_confidence: { label: 'Low confidence', style: 'border-checklist-low_confidence/40 bg-checklist-low_confidence/5 text-checklist-low_confidence' },
  no_matching_sop: { label: 'No matching SOP', style: 'border-checklist-no_matching_sop/40 bg-checklist-no_matching_sop/5 text-checklist-no_matching_sop' },
};

export default function ChecklistView({ checklist, isLoading = false, isError = false }: ChecklistViewProps) {
  const id = useId();
  const [selection, setSelection] = useState<{ citation: Citation; trigger: HTMLButtonElement } | null>(null);
  const closePanel = useCallback(() => setSelection(null), []);
  useEffect(() => setSelection(null), [checklist, isLoading, isError]);
  const status = checklist ? statusLabels[checklist.status] : undefined;
  const StatusIcon = checklist?.status === 'grounded' ? Check : checklist?.status === 'low_confidence' ? AlertTriangle : CircleX;

  return (
    <section aria-labelledby={`${id}-heading`} aria-busy={isLoading}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h3 id={`${id}-heading`} className="text-lg font-semibold tracking-tight">Containment checklist</h3>
        {checklist && !isLoading && !isError && status && <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${status.style}`}><StatusIcon size={13} aria-hidden="true" />{status.label}</span>}
      </div>
      {isLoading ? <div><p role="status" aria-live="polite" className="text-sm text-muted">Waiting for the verified checklist…</p><SkeletonLines /></div>
        : isError ? <p role="status" aria-live="polite" className="text-sm text-muted">The checklist could not be loaded. Retry the analysis.</p>
          : !checklist || !status ? <p className="text-sm text-muted">Run an alert to see containment guidance.</p> : (
            <>
              <p className="mb-4 text-xs text-muted">{checklist.playbook_id ? <>Playbook <span className="font-mono text-content">{checklist.playbook_id}</span> · </> : null}Review each action against its cited source.</p>
              {checklist.status !== 'grounded' && <div className="mb-4"><StatusBanner status={checklist.status} escalation_note={checklist.escalation_note} /></div>}
              {checklist.dropped_count > 0 && <p className="mb-4 flex items-start gap-2 text-xs leading-5 text-muted"><Filter size={14} aria-hidden="true" className="mt-0.5 shrink-0" />{checklist.dropped_count} unsupported {checklist.dropped_count === 1 ? 'step' : 'steps'} removed by the verifier.</p>}
              {checklist.status !== 'no_matching_sop' && checklist.steps.length > 0 ? (
                <ol aria-label="Containment steps" className="space-y-4">
                  {checklist.steps.map((step) => <StepCard key={step.order} step={step} onOpenCitation={(citation, trigger) => setSelection({ citation, trigger })} />)}
                </ol>
              ) : <p className="rounded-lg border border-outline/30 bg-canvas/50 p-4 text-sm text-muted">No containment steps returned.</p>}
              {checklist.related_cves.length > 0 && <section aria-labelledby={`${id}-cves`} className="mt-6 border-t border-outline/25 pt-5"><h3 id={`${id}-cves`} className="mb-3 text-sm font-semibold">Related CVEs</h3><div className="space-y-3">{checklist.related_cves.map((cve) => <CveCard key={cve.id} cve={cve} />)}</div></section>}
              {selection && <CitationPanel citation={selection.citation} returnFocusTo={selection.trigger} onClose={closePanel} />}
            </>
          )}
    </section>
  );
}
