import { CircleDashed, FlaskConical, LoaderCircle, Radio } from 'lucide-react';
import { useHealth } from '../hooks/useHealth';

export default function HealthBadge() {
  const health = useHealth();
  const Icon = health.data?.mock ? FlaskConical : Radio;

  return (
    <div role="status" aria-label="Backend health" aria-live="polite" className="flex min-h-10 items-center gap-2 rounded-full border border-outline/30 px-3 text-xs text-muted">
      {health.isPending ? <><LoaderCircle size={14} className="motion-safe:animate-spin" aria-hidden="true" />Connecting…</>
        : health.isError ? <><CircleDashed size={14} aria-hidden="true" />Service unavailable<button type="button" className="text-content underline underline-offset-4" onClick={() => void health.refetch()}>Retry health</button></>
          : <><Icon size={14} className="text-accent" aria-hidden="true" /><span className="font-medium text-content">{health.data.mock ? 'Mock' : 'Live'}</span><span aria-hidden="true">·</span><span>{health.data.index_chunks} chunks</span></>}
    </div>
  );
}
