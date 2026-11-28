import type { TimingsMs } from '../api/types';

const durations = [
  ['parse', 'Parse'], ['retrieve', 'Retrieve'], ['generate', 'Generate'],
  ['verify', 'Verify'], ['total', 'Total'],
] as const;

export default function TimingsStrip({ timings }: { timings?: TimingsMs }) {
  return (
    <section aria-label="Run timings" className="mb-6 rounded-xl border border-outline/30 bg-panel px-5 py-4">
      {timings ? <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-5">
        {durations.map(([key, label]) => <div key={key}><dt className="mb-1 text-xs text-muted">{label}</dt><dd className={`font-mono text-sm tabular-nums ${key === 'total' ? 'font-semibold text-accent' : 'text-content'}`}>{timings[key].toLocaleString('en-US')} ms</dd></div>)}
      </dl> : <p className="text-sm text-muted">No timings yet. Run an alert to see the reported durations.</p>}
    </section>
  );
}
