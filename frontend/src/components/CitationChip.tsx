import { ArrowUpRight, BookOpen } from 'lucide-react';
import type { Citation } from '../api/types';

export type OpenCitation = (citation: Citation, trigger: HTMLButtonElement) => void;

export default function CitationChip({ citation, onOpen }: { citation: Citation; onOpen: OpenCitation }) {
  return (
    <button
      type="button"
      aria-label={`View source for ${citation.step_id}`}
      aria-haspopup="dialog"
      onClick={(event) => onOpen(citation, event.currentTarget)}
      className="inline-flex min-h-11 max-w-full items-center gap-2 rounded-lg border border-accent/60 bg-accent/10 px-3 py-2.5 text-accent hover:border-accent hover:bg-accent/20"
    >
      <BookOpen size={17} aria-hidden="true" className="shrink-0" />
      <span className="text-xs">View source for </span>
      <span className="min-w-0 break-all font-mono text-sm font-semibold">{citation.step_id}</span>
      <ArrowUpRight size={14} aria-hidden="true" className="shrink-0" />
    </button>
  );
}
