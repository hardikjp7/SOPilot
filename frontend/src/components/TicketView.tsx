import { useCallback, useEffect, useId, useState } from 'react';
import { AlertTriangle, FileText, LockKeyhole } from 'lucide-react';
import type { Citation, IncidentTicket, Severity } from '../api/types';
import CitationChip from './CitationChip';
import CitationPanel from './CitationPanel';
import IocChips from './IocChips';

const severityStyles: Record<Severity, string> = {
  low: 'border-severity-low/40 text-severity-low', medium: 'border-severity-medium/40 text-severity-medium',
  high: 'border-severity-high/40 text-severity-high', critical: 'border-severity-critical/40 text-severity-critical',
};

export default function TicketView({ ticket, approvalConflict = false }: { ticket?: IncidentTicket; approvalConflict?: boolean }) {
  const id = useId();
  const [selection, setSelection] = useState<{ citation: Citation; trigger: HTMLButtonElement } | null>(null);
  const close = useCallback(() => setSelection(null), []);
  useEffect(() => setSelection(null), [ticket]);

  if (!ticket) return <p className="text-sm text-muted">Generate an incident ticket to review it here.</p>;

  return (
    <article aria-labelledby={`${id}-title`} className="min-w-0 space-y-6">
      <header>
        <div className="mb-3 flex flex-wrap items-center gap-3 text-xs">
          <p className="flex items-center gap-2 font-mono text-muted"><FileText size={15} aria-hidden="true" />{ticket.ticket_id}</p>
          <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 font-medium ${severityStyles[ticket.severity]}`}><AlertTriangle size={12} aria-hidden="true" /><span className="sr-only">Severity: </span><span className="capitalize">{ticket.severity}</span></span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-outline/40 px-2 py-1 text-muted">{ticket.status === 'approved' && <LockKeyhole size={12} aria-hidden="true" />}{approvalConflict ? 'Draft snapshot' : ticket.status === 'approved' ? 'Approved' : 'Draft'}</span>
        </div>
        <h3 id={`${id}-title`} className="break-words text-xl font-semibold leading-8 tracking-tight">{ticket.title}</h3>
      </header>

      <div className="grid items-start gap-6 min-[900px]:grid-cols-2">
        <div className="min-w-0 space-y-6">
          <section aria-labelledby={`${id}-timeline`}><h4 id={`${id}-timeline`} className="mb-3 text-sm font-semibold">Timeline</h4>
            {ticket.timeline.length ? <ol className="space-y-3">{ticket.timeline.map((event, index) => <li key={index} className="border-l-2 border-outline/30 pl-3"><p className="mb-1 break-words font-mono text-xs text-muted">{event.time ?? 'Time not provided'}</p><p className="break-words text-sm leading-6">{event.event}</p></li>)}</ol> : <p className="text-sm text-muted">No timeline events returned.</p>}
          </section>
          <section aria-labelledby={`${id}-hypothesis`} className="rounded-xl border border-outline/30 bg-canvas/50 p-4">
            <p className="mb-1 text-xs text-muted">Root cause</p><h4 id={`${id}-hypothesis`} className="text-sm font-semibold">Hypothesis</h4>
            <p className="mt-3 break-words text-sm leading-6">{ticket.root_cause.hypothesis}</p>
            <p className="mt-3 text-xs text-muted">Confidence: <span className="font-mono text-content">{Math.round(ticket.root_cause.confidence * 100)}%</span></p>
            <h5 className="mb-2 mt-4 text-xs font-semibold">Basis</h5>
            {ticket.root_cause.basis.length ? <ul className="list-disc space-y-1 pl-4 text-sm leading-6 text-muted">{ticket.root_cause.basis.map((basis, index) => <li key={index} className="break-words">{basis}</li>)}</ul> : <p className="text-sm text-muted">No basis returned.</p>}
          </section>
          <IocChips key={ticket.ticket_id} iocs={ticket.iocs} />
          <section aria-labelledby={`${id}-assets`}><h4 id={`${id}-assets`} className="mb-2 text-sm font-semibold">Affected assets</h4>{ticket.affected_assets.length ? <ul className="space-y-1 font-mono text-xs leading-6">{ticket.affected_assets.map((asset, index) => <li key={index} className="break-all">{asset}</li>)}</ul> : <p className="text-sm text-muted">No affected assets returned.</p>}</section>
          <section aria-labelledby={`${id}-cves`}><h4 id={`${id}-cves`} className="mb-2 text-sm font-semibold">CVEs</h4>{ticket.cves.length ? <ul className="space-y-1 font-mono text-xs leading-6">{ticket.cves.map((cve, index) => <li key={index} className="break-all">{cve}</li>)}</ul> : <p className="text-sm text-muted">No CVEs returned.</p>}</section>
        </div>
        <section aria-labelledby={`${id}-actions`} className="min-w-0"><h4 id={`${id}-actions`} className="mb-3 text-sm font-semibold">Containment actions</h4>
          {ticket.containment_actions.length ? <ol className="space-y-3">{ticket.containment_actions.map((action, index) => <li key={index} className="rounded-xl border border-outline/30 bg-canvas/40 p-4"><p className="break-words text-sm font-medium leading-6">{action.action}</p><p className="mb-3 mt-2 text-xs text-muted">Status: <span className="capitalize text-content">{action.status}</span></p><CitationChip citation={action.citation} onOpen={(citation, trigger) => setSelection({ citation, trigger })} /></li>)}</ol> : <p className="rounded-lg border border-outline/30 p-4 text-sm text-muted">No containment actions returned.</p>}
        </section>
      </div>
      <dl className="flex flex-wrap gap-x-6 gap-y-3 border-t border-outline/25 pt-4 font-mono text-xs text-muted"><div className="min-w-0"><dt>Run ID</dt><dd className="mt-1 break-all">{ticket.run_id}</dd></div><div className="min-w-0"><dt>Audit reference</dt><dd className="mt-1 break-all">{ticket.audit_ref}</dd></div></dl>
      {selection && <CitationPanel citation={selection.citation} returnFocusTo={selection.trigger} onClose={close} />}
    </article>
  );
}
