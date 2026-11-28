import { useEffect, useState } from 'react';
import { Check, Circle, CircleX, Hourglass, LoaderCircle } from 'lucide-react';
import type { TimingsMs } from '../api/types';
import { useReducedMotion } from '../hooks/useReducedMotion';

interface PipelineStepperProps {
  status: 'idle' | 'pending' | 'success' | 'error';
  timings?: TimingsMs;
}

const stages = [
  { key: 'parse', label: 'Parse' },
  { key: 'retrieve', label: 'Retrieve' },
  { key: 'generate', label: 'Generate' },
  { key: 'verify', label: 'Verify' },
] as const;

const milliseconds = (value: number) => `${value.toLocaleString('en-US')} ms`;

export default function PipelineStepper({ status, timings }: PipelineStepperProps) {
  const [active, setActive] = useState(0);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    setActive(0);
    if (status !== 'pending' || reducedMotion) return;
    const timer = window.setInterval(() => setActive((step) => Math.min(step + 1, stages.length - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [status, reducedMotion]);

  const message = status === 'pending'
    ? reducedMotion ? 'Analysis in progress. Awaiting server response.'
      : `${stages[active]!.label} (simulated). Awaiting server response.`
    : status === 'success' ? 'Run complete. Reported timings.'
      : status === 'error' ? 'Analysis failed. The service did not report which stage failed.'
        : 'Ready for an alert.';
  const StatusIcon = status === 'error' ? CircleX : status === 'success' ? Check : Hourglass;

  return (
    <section aria-label="Analysis pipeline" className={`rounded-xl border p-4 ${status === 'error' ? 'border-severity-critical/50' : 'border-outline/30'} bg-canvas/50`}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-semibold tracking-wide text-muted">ANALYSIS PIPELINE</h3>
        {status === 'success' && timings && <span className="font-mono text-xs text-muted">Total {milliseconds(timings.total)}</span>}
      </div>
      <ol className="grid grid-cols-2 gap-2 min-[1200px]:grid-cols-4">
        {stages.map((stage, index) => {
          const current = status === 'pending' && !reducedMotion && index === active;
          const reported = status === 'success' && timings !== undefined;
          const Icon = reported ? Check : current ? LoaderCircle : Circle;
          const detail = reported ? milliseconds(timings[stage.key])
            : status === 'error' ? 'Not confirmed'
              : status === 'pending' ? current ? 'Simulated' : 'Awaiting response' : 'Not started';
          return (
            <li key={stage.key} aria-current={current ? 'step' : undefined} className={`min-w-0 rounded-lg border p-3 ${current ? 'border-accent/60 bg-accent/5' : 'border-outline/25'}`}>
              <p className="flex items-center gap-2 text-sm font-medium">
                <Icon size={14} aria-hidden="true" className={`${reported || current ? 'text-accent' : 'text-muted'} ${current ? 'motion-safe:animate-spin' : ''} shrink-0`} />
                {stage.label}
              </p>
              <p className="mt-2 break-words font-mono text-xs leading-5 text-muted">{detail}</p>
            </li>
          );
        })}
      </ol>
      <p role="status" aria-live="polite" className={`mt-3 flex items-start gap-2 text-xs leading-5 ${status === 'error' ? 'text-severity-critical' : 'text-muted'}`}>
        <StatusIcon size={14} aria-hidden="true" className="mt-0.5 shrink-0" />{message}
      </p>
    </section>
  );
}
