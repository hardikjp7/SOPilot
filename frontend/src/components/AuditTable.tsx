import { Fragment, useEffect, useId, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, History, LoaderCircle, RefreshCw } from 'lucide-react';
import { useAudit } from '../hooks/useAudit';
import ErrorNotice from './ErrorNotice';
import SkeletonLines from './SkeletonLines';

function shortHash(hash: string): string {
  return hash.length > 24 ? `${hash.slice(0, 14)}…${hash.slice(-6)}` : hash;
}

export default function AuditTable({ runId }: { runId?: string }) {
  const audit = useAudit(runId);
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  const id = useId();
  useEffect(() => setExpanded(new Set()), [runId]);
  const rows = audit.data ?? [];
  const mismatched = rows.some((row) => row.run_id !== runId);

  return (
    <section aria-labelledby={`${id}-title`} aria-busy={!!runId && audit.isFetching} className="min-w-0 rounded-2xl border border-outline/30 bg-panel p-5 shadow-sm sm:p-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div><h2 id={`${id}-title`} className="flex items-center gap-2 text-lg font-semibold tracking-tight"><History size={19} aria-hidden="true" className="text-muted" />Audit trail</h2><p className="mt-2 break-all font-mono text-xs text-muted">{runId ?? 'No run selected'}</p></div>
        {runId && <button type="button" disabled={audit.isFetching} onClick={() => void audit.refetch()} className="button-secondary text-sm"><RefreshCw size={14} aria-hidden="true" />Refresh audit</button>}
      </div>
      {!runId ? <div className="rounded-xl border border-dashed border-outline/40 px-5 py-12 text-center"><h3 className="mb-2 text-base font-medium">No run yet</h3><p className="text-sm leading-6 text-muted">Run an alert in Workspace to view its audit trail.</p></div>
        : audit.isPending ? <div><p role="status" aria-live="polite" className="flex items-center gap-2 text-sm text-muted"><LoaderCircle size={17} className="motion-safe:animate-spin" aria-hidden="true" />Loading audit records…</p><SkeletonLines /></div>
          : <>
            {audit.isError && <div className="mb-4"><ErrorNotice error={audit.error} onRetry={() => void audit.refetch()} retryLabel="Retry audit" /></div>}
            {mismatched ? <p role="alert" className="flex items-start gap-2 rounded-xl border border-severity-critical/40 p-4 text-sm leading-6"><AlertTriangle size={18} className="mt-1 shrink-0 text-severity-critical" aria-hidden="true" />The audit response contains records for another run. Refresh the audit to try again.</p>
              : rows.length ? <>
                <p role="status" aria-live="polite" className="mb-3 text-xs text-muted">{audit.isFetching ? 'Refreshing audit records…' : `${rows.length} audit ${rows.length === 1 ? 'record' : 'records'} returned.`}</p>
                <div role="region" aria-label="Audit table scroll area" tabIndex={0} className="overflow-x-auto rounded-xl border border-outline/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus">
                  <table className="w-full min-w-[880px] border-collapse text-left text-sm">
                    <caption className="sr-only">Audit records for {runId}</caption>
                    <thead className="bg-canvas/70 text-xs text-muted"><tr>{['Stage', 'Time', 'Model', 'Input hash', 'Output hash', 'Details'].map((label) => <th key={label} scope="col" className="px-4 py-3 font-medium">{label}</th>)}</tr></thead>
                    <tbody>
                      {rows.map((row) => {
                        const open = expanded.has(row.id);
                        const Icon = open ? ChevronUp : ChevronDown;
                        return (
                          <Fragment key={row.id}>
                            <tr className="border-t border-outline/20 align-top hover:bg-content/5">
                              <th scope="row" className="px-4 py-4 font-medium capitalize">{row.stage}</th>
                              <td className="whitespace-nowrap px-4 py-4 font-mono text-xs text-muted"><time dateTime={row.ts}>{row.ts}</time></td>
                              <td className="max-w-[16rem] break-all px-4 py-4 font-mono text-xs text-muted">{row.model ?? 'Not recorded'}</td>
                              <td className="px-4 py-4"><code title={row.input_hash} className="whitespace-nowrap font-mono text-xs text-muted">{shortHash(row.input_hash)}</code></td>
                              <td className="px-4 py-4"><code title={row.output_hash} className="whitespace-nowrap font-mono text-xs text-muted">{shortHash(row.output_hash)}</code></td>
                              <td className="px-4 py-3"><button type="button" aria-expanded={open} aria-controls={`${id}-details-${row.id}`} aria-label={`${open ? 'Hide' : 'Show'} details for ${row.stage} audit row ${row.id}`} onClick={() => setExpanded((previous) => { const next = new Set(previous); if (next.has(row.id)) next.delete(row.id); else next.add(row.id); return next; })} className="button-secondary gap-1 text-xs"><Icon size={14} aria-hidden="true" />{open ? 'Hide' : 'Details'}</button></td>
                            </tr>
                            {open && <tr id={`${id}-details-${row.id}`} className="border-t border-outline/20 bg-canvas/40"><td colSpan={6} className="p-4">
                              <dl className="mb-4 grid gap-3 text-xs sm:grid-cols-2"><div className="min-w-0"><dt className="mb-1 text-muted">Full input hash</dt><dd className="break-all font-mono">{row.input_hash}</dd></div><div className="min-w-0"><dt className="mb-1 text-muted">Full output hash</dt><dd className="break-all font-mono">{row.output_hash}</dd></div></dl>
                              <pre role="region" aria-label={`Formatted details for ${row.stage} audit row ${row.id}`} tabIndex={0} className="max-w-full whitespace-pre-wrap break-words rounded-lg border border-outline/30 bg-canvas p-4 font-mono text-xs leading-6 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus">{JSON.stringify(row.details_json, null, 2)}</pre>
                            </td></tr>}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </> : !audit.isError && <div className="rounded-xl border border-dashed border-outline/40 px-5 py-12 text-center"><h3 className="mb-2 text-base font-medium">No audit records yet</h3><p className="text-sm leading-6 text-muted">No audit rows were returned for this run. Refresh to check again.</p></div>}
          </>}
    </section>
  );
}
