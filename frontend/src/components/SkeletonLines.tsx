/** Decorative placeholders. The containing view provides the loading announcement. */
export default function SkeletonLines({ rows = 3 }: { rows?: number }) {
  return (
    <div aria-hidden="true" className="mt-5 space-y-4 motion-safe:animate-pulse">
      {Array.from({ length: rows }, (_, index) => <div key={index} className="space-y-3 rounded-xl border border-outline/20 p-4">
        <div className="h-4 w-2/3 rounded bg-outline/20" />
        <div className="h-3 w-full rounded bg-outline/20" />
        <div className="h-3 w-4/5 rounded bg-outline/20" />
      </div>)}
    </div>
  );
}
