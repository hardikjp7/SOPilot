import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, FileSearch, History, Layers3, ListChecks, LoaderCircle, LockKeyhole, ShieldCheck, Type } from 'lucide-react';
import AlertInput from './components/AlertInput';
import AuditTable from './components/AuditTable';
import ChecklistView from './components/ChecklistView';
import ErrorNotice from './components/ErrorNotice';
import HealthBadge from './components/HealthBadge';
import ParsedAlertCard from './components/ParsedAlertCard';
import PipelineStepper from './components/PipelineStepper';
import ThemeToggle from './components/ThemeToggle';
import TicketWorkflow from './components/TicketWorkflow';
import TimingsStrip from './components/TimingsStrip';
import SkeletonLines from './components/SkeletonLines';
import StatusLegend from './components/StatusLegend';
import { useDisplayPreferences } from './hooks/useDisplayPreferences';
import { useRun } from './hooks/useRun';

export default function App() {
  const { theme, setTheme, largeText, setLargeText, demoShortcut, setDemoShortcut } = useDisplayPreferences();
  const [activeTab, setActiveTab] = useState<'workspace' | 'audit'>('workspace');
  const tabButtons = useRef<(HTMLButtonElement | null)[]>([]);
  const run = useRun();
  const running = useRef(false);
  const lastAlert = useRef<Record<string, unknown> | null>(null);
  const alertEditor = useRef<HTMLTextAreaElement>(null);
  const runFocus = useRef<HTMLDivElement>(null);
  const previousStatus = useRef(run.status);
  useEffect(() => {
    if (previousStatus.current !== run.status) {
      previousStatus.current = run.status;
      if (activeTab === 'workspace' && run.status !== 'idle') runFocus.current?.focus();
    }
  }, [run.status, activeTab]);
  const { mutate } = run;
  const startRun = useCallback((alert: Record<string, unknown>) => {
    if (running.current) return;
    running.current = true;
    setActiveTab('workspace');
    lastAlert.current = alert;
    mutate(alert, { onSettled: () => { running.current = false; } });
  }, [mutate]);
  const currentRunId = run.isSuccess ? run.data.run_id : undefined;

  return (
    <div className={`${theme} min-h-screen bg-canvas font-sans text-content`}>
      <a href="#workspace" className="sr-only z-50 rounded bg-panel p-3 text-content focus:not-sr-only focus:fixed focus:left-4 focus:top-4">Skip to workspace</a>
      <header className="border-b border-outline/25 bg-panel">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-4 px-5 py-4 sm:px-8 lg:px-10">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-accent/30 bg-accent/10 text-accent"><ShieldCheck size={23} aria-hidden="true" /></div>
            <div><p className="text-xl font-semibold tracking-tight">SOPilot</p><p className="text-xs tracking-wide text-muted">SECURITY OPERATIONS</p></div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <HealthBadge />
            <button type="button" aria-pressed={largeText} onClick={() => setLargeText((current) => !current)} className={`button-secondary text-sm ${largeText ? 'border-accent bg-accent/10 text-accent' : ''}`}><Type size={17} aria-hidden="true" />Larger text{largeText && <Check size={15} aria-hidden="true" />}</button>
            <ThemeToggle theme={theme} onToggle={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))} />
          </div>
        </div>
      </header>

      <main id="workspace" tabIndex={-1} aria-label="SOPilot workspace" className="mx-auto max-w-[1440px] px-5 pb-10 pt-8 sm:px-8 lg:px-10">
        <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="mb-3 flex items-center gap-2 text-xs font-medium tracking-wide text-muted"><Layers3 size={14} aria-hidden="true" />ANALYST WORKSPACE</p>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">From alert to action.</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">Turn a raw security alert into guidance grounded in your approved playbooks.</p>
          </div>
          <p className="mb-1 flex items-center gap-2 text-xs text-muted"><LockKeyhole size={13} aria-hidden="true" />Analyst approval required</p>
        </div>

        <StatusLegend demoShortcut={demoShortcut} onDemoShortcutChange={setDemoShortcut} />

        <div role="tablist" aria-label="Investigation views" className="mb-6 flex gap-2 border-b border-outline/25 pb-3">
          {(['workspace', 'audit'] as const).map((tab, index) => {
            const Icon = tab === 'workspace' ? Layers3 : History;
            return <button key={tab} ref={(button) => { tabButtons.current[index] = button; }} id={`investigation-${tab}-tab`} type="button" role="tab" aria-selected={activeTab === tab} aria-controls={`investigation-${tab}-panel`} tabIndex={activeTab === tab ? 0 : -1} onClick={() => setActiveTab(tab)} onKeyDown={(event) => {
              if (event.ctrlKey || event.altKey || event.metaKey) return;
              const next = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : event.key === 'ArrowRight' || event.key === 'ArrowLeft' ? 1 - index : undefined;
              if (next === undefined) return;
              event.preventDefault();
              setActiveTab(next === 0 ? 'workspace' : 'audit');
              tabButtons.current[next]?.focus();
            }} className={`inline-flex min-h-11 items-center gap-2 rounded-lg border px-4 text-sm font-medium ${activeTab === tab ? 'border-accent/40 bg-accent/10 text-accent' : 'border-transparent text-muted hover:bg-content/5 hover:text-content'}`}><Icon size={15} aria-hidden="true" />{tab === 'workspace' ? 'Workspace' : 'Audit'}</button>;
          })}
        </div>
        {(run.isSuccess || activeTab === 'audit') && <TimingsStrip timings={run.isSuccess ? run.data.timings_ms : undefined} />}

        <div id="investigation-workspace-panel" role="tabpanel" aria-labelledby="investigation-workspace-tab" tabIndex={0} hidden={activeTab !== 'workspace'} className="rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus">
        <div className="grid items-start gap-6 min-[900px]:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
          <div className="min-w-0 space-y-6">
            <AlertInput onRun={startRun} isRunning={run.isPending} inputRef={alertEditor} demoShortcut={demoShortcut} />
            {run.status !== 'idle' && <ParsedAlertCard parsed={run.isSuccess ? run.data.parsed : undefined} isLoading={run.isPending} isError={run.isError} />}
          </div>
          <section aria-labelledby="investigation-heading" className="flex min-h-[640px] flex-col overflow-hidden rounded-2xl border border-outline/30 bg-panel shadow-sm">
            <div className="border-b border-outline/20 p-6">
              <p className="mb-2 text-xs font-semibold tracking-[0.16em] text-muted">02 / INVESTIGATION</p>
              <h2 id="investigation-heading" className="text-lg font-semibold tracking-tight">Response workspace</h2>
              <p className="mt-1 text-sm text-muted">Evidence first. Every action traceable.</p>
            </div>

            <div className="p-5"><PipelineStepper status={run.status} timings={run.data?.timings_ms} /></div>
            {run.status !== 'idle' && <div key={run.status} ref={runFocus} tabIndex={-1} role="group" aria-label={run.isPending ? 'Analysis in progress' : run.isError ? 'Analysis needs attention' : 'Analysis ready for review'} className="focus-target mx-5 mb-5 rounded-xl">
            {run.isPending ? (
              <div className="p-1">
                <div role="status" aria-live="polite" className="flex items-center gap-3"><LoaderCircle size={23} className="shrink-0 text-accent motion-safe:animate-spin" aria-hidden="true" /><h3 className="text-lg font-medium">Analyzing your alert</h3></div>
                <p className="mt-3 text-sm leading-6 text-muted">Checking the alert against approved procedures. This may take a moment.</p>
                <SkeletonLines />
              </div>
            ) : run.isError ? <ErrorNotice error={run.error} onRetry={() => { if (lastAlert.current) startRun(lastAlert.current); }} onEditInput={() => alertEditor.current?.focus()} /> : run.data ? (
              <div>
                <p role="status" aria-live="polite" className="mb-5 flex items-center gap-2 text-sm font-medium"><Check size={18} className="text-accent" aria-hidden="true" />Analysis received</p>
                <ChecklistView checklist={run.data.checklist} />
                <p className="mt-6 break-all font-mono text-xs text-muted">{run.data.run_id}</p>
              </div>
            ) : null}
            </div>}
            {run.status === 'idle' && (
              <div className="flex flex-1 flex-col items-center justify-center px-6 py-12 text-center sm:px-10">
                <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl border border-outline/30 bg-canvas text-muted"><FileSearch size={29} strokeWidth={1.4} aria-hidden="true" /></div>
                <h3 className="text-xl font-medium tracking-tight">Your investigation starts here</h3>
                <p className="mt-3 max-w-sm text-sm leading-6 text-muted">Add an alert on the left. SOPilot will find the evidence behind your next steps.</p>
                <ol className="mt-9 w-full max-w-sm space-y-5 text-left">
                  {[
                    ['Parse the alert', 'Extract key details and indicators.'],
                    ['Match approved playbooks', 'Find relevant internal procedures.'],
                    ['Review cited guidance', 'Trace recommendations to their source.'],
                  ].map(([title, description], index) => <li key={title} className="flex items-start gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-outline/40 font-mono text-xs text-muted">{index + 1}</span><div><p className="text-sm font-medium">{title}</p><p className="mt-1 text-xs leading-5 text-muted">{description}</p></div></li>)}
                </ol>
              </div>
            )}
            <div className="mt-auto flex items-center gap-2 border-t border-outline/20 bg-canvas/40 px-6 py-4 text-xs text-muted"><ListChecks size={15} className="shrink-0" aria-hidden="true" />Grounded in playbooks. Reviewed by you.</div>
          </section>
        </div>
        {run.isSuccess && <TicketWorkflow key={run.data.run_id} runId={run.data.run_id} />}
        </div>
        <div id="investigation-audit-panel" role="tabpanel" aria-labelledby="investigation-audit-tab" tabIndex={0} hidden={activeTab !== 'audit'} className="rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus">
          {activeTab === 'audit' && <AuditTable runId={currentRunId} />}
        </div>
        <footer className="mt-6 flex flex-wrap justify-between gap-2 text-xs text-muted"><span>SOPilot / Security operations workspace</span><span>Evidence before action.</span></footer>
      </main>
    </div>
  );
}
