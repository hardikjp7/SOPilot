import { useEffect, useId, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, ArrowRight, Check, ChevronDown, FileJson2, LoaderCircle } from 'lucide-react';
import { apiClient } from '../api';
import { validateAlertJson } from '../lib/validateAlertJson';

interface AlertInputProps {
  onRun: (alert: Record<string, unknown>) => void;
  isRunning: boolean;
  inputRef?: RefObject<HTMLTextAreaElement>;
  demoShortcut?: boolean;
}

export default function AlertInput({ onRun, isRunning, inputRef, demoShortcut = true }: AlertInputProps) {
  const [input, setInput] = useState('');
  const [sampleId, setSampleId] = useState('');
  const internalEditor = useRef<HTMLTextAreaElement>(null);
  const editor = inputRef ?? internalEditor;
  const id = useId();
  const samples = useQuery({ queryKey: ['samples'], queryFn: () => apiClient.samples(), retry: false });
  const validation = validateAlertJson(input);
  const demo = samples.data?.find((sample) => sample.id === 'ransomware-fin-ws')
    ?? samples.data?.find((sample) => /ransomware/i.test(sample.name));

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      const target = event.target;
      if (event.key.toLowerCase() !== 'd' || event.repeat || event.isComposing
        || event.ctrlKey || event.metaKey || event.altKey || isRunning || !demo || !demoShortcut) return;
      if (target instanceof HTMLElement
        && (target.isContentEditable || target.closest('input, textarea, select, [contenteditable]'))) return;

      const value = JSON.stringify(demo.alert, null, 2);
      const checked = validateAlertJson(value);
      if (!checked.valid) return;
      event.preventDefault();
      setInput(value);
      setSampleId(demo.id);
      onRun(checked.alert);
    }
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [demo, isRunning, onRun, demoShortcut]);

  return (
    <section aria-labelledby={`${id}-heading`} className="overflow-hidden rounded-2xl border border-outline/30 bg-panel shadow-sm">
      <div className="flex items-start justify-between gap-4 border-b border-outline/20 p-5">
        <div>
          <p className="mb-2 text-xs font-semibold tracking-[0.16em] text-muted">01 / ALERT INTAKE</p>
          <h2 id={`${id}-heading`} className="text-lg font-semibold tracking-tight">Start with an alert</h2>
          <p className="mt-1 text-sm leading-6 text-muted">Paste raw JSON or load a sample to investigate.</p>
        </div>
        <FileJson2 className="mt-1 shrink-0 text-muted" size={21} aria-hidden="true" />
      </div>

      <form className="p-5" onSubmit={(event) => {
        event.preventDefault();
        if (validation.valid && !isRunning) onRun(validation.alert);
      }}>
        <label htmlFor={`${id}-sample`} className="mb-2 block text-sm font-medium">Sample alert</label>
        <div className="relative">
          <select
            id={`${id}-sample`}
            value={sampleId}
            disabled={samples.isPending || isRunning || !samples.data?.length}
            aria-describedby={`${id}-sample-status`}
            className="control w-full appearance-none py-3 pl-3 pr-10 text-sm"
            onChange={(event) => {
              const sample = samples.data?.find((item) => item.id === event.target.value);
              setSampleId(sample?.id ?? '');
              if (sample) {
                setInput(JSON.stringify(sample.alert, null, 2));
                editor.current?.focus();
              }
            }}
          >
            <option value="">{samples.isPending ? 'Loading sample alerts…' : 'Choose a sample alert'}</option>
            {samples.data?.map((sample) => <option key={sample.id} value={sample.id}>{sample.name}</option>)}
          </select>
          <ChevronDown className="pointer-events-none absolute right-3 top-3.5 text-muted" size={16} aria-hidden="true" />
        </div>
        <div id={`${id}-sample-status`} className="mt-2 text-xs text-muted" role="status" aria-live="polite">
          {samples.isPending ? 'Loading available samples…' : samples.isError ? (
            <span className="flex flex-wrap items-center gap-2">
              <AlertCircle size={14} aria-hidden="true" /> Samples could not be loaded. You can still paste an alert.
              <button type="button" className="text-content underline underline-offset-4" onClick={() => void samples.refetch()}>Retry samples</button>
            </span>
          ) : samples.data?.length === 0 ? 'No sample alerts are available. Paste an alert below.' : null}
        </div>

        <div className="mb-2 mt-4 flex items-center justify-between gap-3">
          <label htmlFor={`${id}-json`} className="text-sm font-medium">Alert JSON</label>
          <span className="rounded border border-outline/30 px-1.5 py-0.5 font-mono text-xs tracking-wide text-muted">JSON</span>
        </div>
        <textarea
          ref={editor}
          id={`${id}-json`}
          value={input}
          onChange={(event) => { setInput(event.target.value); setSampleId(''); }}
          disabled={isRunning}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          aria-invalid={!!validation.error}
          aria-describedby={`${id}-hint ${id}-validation`}
          placeholder={'{\n  "message": "Paste a security alert here"\n}'}
          className={`control min-h-[224px] w-full resize-y p-4 font-mono text-xs leading-6 placeholder:text-muted ${validation.error ? 'border-severity-critical' : ''}`}
        />
        <div id={`${id}-hint`} className="mt-2 flex flex-wrap justify-between gap-2 text-xs text-muted">
          <span>JSON object only · 200 KB maximum</span>
          <span className="font-mono tabular-nums">{(validation.bytes / 1024).toFixed(1)} / 200 KB</span>
        </div>
        <div id={`${id}-validation`} className="mt-3 min-h-6 text-xs leading-5" role="status" aria-live="polite">
          {validation.error ? (
            <p className="flex items-start gap-2 text-severity-critical"><AlertCircle className="mt-0.5 shrink-0" size={14} aria-hidden="true" />{validation.error}</p>
          ) : validation.valid ? (
            <p className="flex items-center gap-2 text-checklist-grounded"><Check size={14} aria-hidden="true" />Valid JSON object. Ready to analyze.</p>
          ) : <p className="text-muted">Add an alert to enable analysis.</p>}
        </div>

        <div className="mt-3 border-t border-outline/20 pt-4">
          <button type="submit" disabled={!validation.valid || isRunning} className="button-primary w-full justify-center py-3 text-sm">
            {isRunning ? <LoaderCircle size={17} className="motion-safe:animate-spin" aria-hidden="true" /> : <ArrowRight size={17} aria-hidden="true" />}
            {isRunning ? 'Running analysis…' : 'Run analysis'}
          </button>
          <p className="mt-3 text-center text-xs leading-5 text-muted">Recommendations require analyst approval.</p>
        </div>
      </form>
    </section>
  );
}
