import { BookOpen, ChevronDown } from 'lucide-react';

const entries = [
  ['Grounded', 'Verified guidance from an approved playbook.'],
  ['Low confidence', 'Kept steps need manual review; read the escalation note.'],
  ['No matching SOP', 'Escalate using the note. No containment steps are suggested.'],
  ['Verified · Partial support', 'Verified checks passed; partial support still needs closer review.'],
  ['Citation chips', 'Open a step ID to read its exact playbook source.'],
  ['Severity', 'Critical, high, medium and low are the reported urgency levels.'],
  ['Draft · Approved', 'Review a draft; an approved ticket is read-only.'],
  ['Mock · Live', 'Canned demo responses or the connected service; chunks show index size.'],
] as const;

export default function StatusLegend({ demoShortcut, onDemoShortcutChange }: { demoShortcut: boolean; onDemoShortcutChange: (enabled: boolean) => void }) {
  return (
    <details className="status-legend mb-6 rounded-xl border border-outline/40 bg-panel">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-xl px-4 py-3 text-sm font-medium">
        <BookOpen size={16} className="text-accent" aria-hidden="true" />Badge &amp; status guide<ChevronDown size={16} className="legend-chevron ml-auto shrink-0 text-muted" aria-hidden="true" />
      </summary>
      <div className="border-t border-outline/25 p-4 sm:p-5">
        <dl className="grid gap-x-8 gap-y-4 min-[900px]:grid-cols-2">
          {entries.map(([label, meaning]) => <div key={label}><dt className="text-sm font-semibold">{label}</dt><dd className="mt-1 text-sm leading-6 text-muted">{meaning}</dd></div>)}
        </dl>
        <div className="mt-5 border-t border-outline/25 pt-4">
          <label className="inline-flex min-h-11 cursor-pointer items-center gap-3 text-sm font-medium"><input type="checkbox" checked={demoShortcut} onChange={(event) => onDemoShortcutChange(event.target.checked)} aria-describedby="demo-shortcut-hint" className="h-5 w-5 accent-accent" />Enable D demo shortcut</label>
          <p id="demo-shortcut-hint" className="mt-1 text-xs leading-6 text-muted">Outside text fields, press D to load and run the ransomware sample. Turn this off when using single-key assistive commands.</p>
        </div>
      </div>
    </details>
  );
}
