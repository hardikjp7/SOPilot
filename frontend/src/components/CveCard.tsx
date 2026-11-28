import { AlertTriangle } from 'lucide-react';
import type { RelatedCve, Severity } from '../api/types';

const severityStyles: Record<Severity, string> = {
  low: 'border-severity-low/40 bg-severity-low/10 text-severity-low',
  medium: 'border-severity-medium/40 bg-severity-medium/10 text-severity-medium',
  high: 'border-severity-high/40 bg-severity-high/10 text-severity-high',
  critical: 'border-severity-critical/40 bg-severity-critical/10 text-severity-critical',
};

export default function CveCard({ cve }: { cve: RelatedCve }) {
  return (
    <article aria-label={cve.id} className="min-w-0 rounded-xl border border-outline/30 bg-canvas/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h4 className="break-all font-mono text-sm font-semibold">{cve.id}</h4>
        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs font-medium ${severityStyles[cve.severity]}`}><AlertTriangle size={12} aria-hidden="true" /><span className="sr-only">Severity: </span><span className="capitalize">{cve.severity}</span></span>
      </div>
      <p className="mt-3 text-xs text-muted">CVSS: <span className="font-mono text-content">{cve.cvss === null ? 'Not provided' : cve.cvss}</span></p>
      <p className="mb-1 mt-4 text-xs font-medium text-muted">Remediation</p>
      <p className="break-words text-sm leading-6">{cve.remediation}</p>
    </article>
  );
}
