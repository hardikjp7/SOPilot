import { AlertTriangle, FileSearch, HelpCircle, ScanLine, ShieldCheck } from 'lucide-react';
import type { AttackType, ParsedAlert, Severity } from '../api/types';
import IocChips from './IocChips';
import SkeletonLines from './SkeletonLines';

interface ParsedAlertCardProps {
  parsed?: ParsedAlert;
  isLoading?: boolean;
  isError?: boolean;
}

const attacks: Record<AttackType, string> = {
  phishing: 'Phishing', ransomware: 'Ransomware', credential_stuffing: 'Credential stuffing',
  ddos: 'DDoS', public_s3_bucket: 'Public S3 bucket', unknown: 'Unknown',
};
const severities: Record<Severity, { label: string; style: string }> = {
  low: { label: 'Low', style: 'border-severity-low/40 bg-severity-low/10 text-severity-low' },
  medium: { label: 'Medium', style: 'border-severity-medium/40 bg-severity-medium/10 text-severity-medium' },
  high: { label: 'High', style: 'border-severity-high/40 bg-severity-high/10 text-severity-high' },
  critical: { label: 'Critical', style: 'border-severity-critical/40 bg-severity-critical/10 text-severity-critical' },
};

export default function ParsedAlertCard({ parsed, isLoading = false, isError = false }: ParsedAlertCardProps) {
  const heading = 'Parsed alert';
  const unknown = parsed?.attack_type === 'unknown';
  const AttackIcon = unknown ? HelpCircle : ScanLine;
  const severity = parsed ? severities[parsed.severity] : undefined;

  return (
    <section aria-label={heading} aria-busy={isLoading} className="min-w-0 overflow-hidden rounded-2xl border border-outline/30 bg-panel shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-outline/20 p-5">
        <h2 className="text-lg font-semibold tracking-tight">{heading}</h2>
        <FileSearch size={19} className="text-muted" aria-hidden="true" />
      </div>
      {isLoading ? (
        <div className="p-5" role="status" aria-live="polite">
          <p className="text-sm text-muted">Waiting for parsed alert…</p>
          <SkeletonLines rows={1} />
        </div>
      ) : isError ? (
        <p role="status" aria-live="polite" className="p-5 text-sm leading-6 text-muted">Analysis could not be completed. No parsed alert was returned.</p>
      ) : !parsed || !severity ? (
        <p className="p-5 text-sm text-muted">Run an alert to see parsed details.</p>
      ) : (
        <div className="space-y-5 p-5">
          <div>
            <p className="break-all font-mono text-sm font-medium">{parsed.alert_id}</p>
            <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted">
              <div className="flex gap-1"><dt>Source:</dt><dd className="break-all">{parsed.source}</dd></div>
              <div className="flex gap-1"><dt>Timestamp:</dt><dd className="break-all">{parsed.timestamp ?? 'Not provided'}</dd></div>
            </dl>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${unknown ? 'border-outline/40 bg-canvas text-muted' : 'border-accent/30 bg-accent/5 text-accent'}`}>
              <AttackIcon size={13} aria-hidden="true" /><span className="sr-only">Attack type: </span>{attacks[parsed.attack_type]}
            </span>
            <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${severity.style}`}>
              <AlertTriangle size={13} aria-hidden="true" /><span className="sr-only">Severity: </span>{severity.label}
            </span>
          </div>
          <div>
            <div className="mb-2 flex items-center justify-between gap-2 text-xs"><p className="text-muted">Classification confidence</p><p className="font-mono">{Math.round(parsed.confidence * 100)}%</p></div>
            <div role="meter" aria-label="Classification confidence" aria-valuemin={0} aria-valuemax={1} aria-valuenow={parsed.confidence} aria-valuetext={`${Math.round(parsed.confidence * 100)}%`} className="h-1.5 overflow-hidden rounded-full bg-outline/25">
              <div aria-hidden="true" style={{ width: `${parsed.confidence * 100}%` }} className={`h-full rounded-full ${unknown ? 'bg-muted' : 'bg-accent'}`} />
            </div>
          </div>
          <p className="break-words text-sm leading-7">{parsed.summary}</p>
          <div>
            <h3 className="mb-2 text-sm font-semibold">Evidence fields</h3>
            {parsed.evidence_fields.length ? <ul className="flex flex-wrap gap-2">{parsed.evidence_fields.map((field) => <li key={field} className="max-w-full rounded bg-canvas px-2 py-1"><code className="break-all font-mono text-xs text-muted">{field}</code></li>)}</ul>
              : <p className="text-sm text-muted">No evidence fields returned.</p>}
          </div>
          {parsed.redacted && <p className="flex items-center gap-2 rounded-lg border border-outline/25 bg-canvas/50 p-3 text-xs leading-5 text-muted"><ShieldCheck size={15} aria-hidden="true" className="shrink-0" />Redaction applied during processing.</p>}
          <div className="border-t border-outline/20 pt-5"><IocChips key={parsed.alert_id} iocs={parsed.iocs} /></div>
        </div>
      )}
    </section>
  );
}
