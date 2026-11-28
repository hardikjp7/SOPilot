import { useEffect, useId, useRef } from 'react';
import { BookOpen, X } from 'lucide-react';
import type { Citation } from '../api/types';

interface CitationPanelProps {
  citation: Citation;
  returnFocusTo: HTMLElement;
  onClose: () => void;
}

export default function CitationPanel({ citation, returnFocusTo, onClose }: CitationPanelProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => {
    const panel = dialog.current;
    if (!panel) return;
    const previousOverflow = document.body.style.overflow;
    panel.showModal();
    closeButton.current?.focus();
    document.body.style.overflow = 'hidden';
    return () => {
      if (panel.open) panel.close();
      document.body.style.overflow = previousOverflow;
      if (returnFocusTo.isConnected) returnFocusTo.focus({ preventScroll: true });
    };
  }, [returnFocusTo]);

  return (
    <dialog
      ref={dialog}
      aria-modal="true"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-description`}
      className="fixed inset-y-0 left-auto right-0 m-0 h-[100dvh] max-h-none w-full max-w-[560px] border-0 border-l border-outline/40 bg-panel p-0 text-content shadow-2xl backdrop:bg-canvas/75 backdrop:backdrop-blur-sm"
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onKeyDown={(event) => {
        // Keep global shortcuts (including demo D) outside the modal inactive.
        event.stopPropagation();
        if (event.key === 'Escape') { event.preventDefault(); onClose(); }
        if (event.key === 'Tab') {
          const controls = event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex="0"]');
          const first = controls[0];
          const last = controls[controls.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault(); last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault(); first?.focus();
          }
        }
      }}
    >
      <div className="flex h-full flex-col">
        <header className="border-b border-outline/30 p-5 sm:p-6">
          <div className="mb-5 flex items-center justify-between gap-4">
            <p className="flex items-center gap-2 text-xs font-semibold tracking-[0.12em] text-accent"><BookOpen size={16} aria-hidden="true" />CITED SOURCE</p>
            <button ref={closeButton} type="button" onClick={onClose} aria-label="Close citation panel" className="button-secondary min-h-11"><X size={16} aria-hidden="true" />Close</button>
          </div>
          <h2 id={`${id}-title`} className="text-xl font-semibold tracking-tight">Playbook citation</h2>
          <p id={`${id}-description`} className="mt-2 text-sm leading-6 text-muted">Exact source text returned with this step.</p>
          <dl className="mt-5 grid grid-cols-2 gap-3">
            <div className="min-w-0 rounded-lg border border-outline/30 bg-canvas p-3"><dt className="text-xs text-muted">Playbook ID</dt><dd className="mt-1 break-all font-mono text-sm">{citation.playbook_id}</dd></div>
            <div className="min-w-0 rounded-lg border border-accent/40 bg-accent/5 p-3"><dt className="text-xs text-muted">Step ID</dt><dd className="mt-1 break-all font-mono text-sm font-semibold text-accent">{citation.step_id}</dd></div>
          </dl>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-6">
          <h3 className="mb-3 text-sm font-semibold">Exact source text</h3>
          <pre tabIndex={0} role="region" aria-label="Exact playbook source" className="whitespace-pre-wrap break-words rounded-xl border border-outline/40 bg-canvas p-4 font-mono text-sm leading-7"><code>{citation.source_text}</code></pre>
        </div>
        <footer className="border-t border-outline/30 px-5 py-4 text-xs text-muted sm:px-6">Press Esc to close and return to the citation.</footer>
      </div>
    </dialog>
  );
}
