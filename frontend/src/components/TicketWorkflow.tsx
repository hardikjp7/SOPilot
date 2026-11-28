import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Copy, Download, FilePlus2, LoaderCircle } from 'lucide-react';
import { apiClient } from '../api';
import { useApproveTicket, useTicket } from '../hooks/useTicket';
import { downloadTicketMarkdown } from '../lib/downloadTicketMarkdown';
import { AppError, normalizeApiError } from '../lib/errors';
import ApprovalBar from './ApprovalBar';
import ErrorNotice from './ErrorNotice';
import TicketView from './TicketView';
import SkeletonLines from './SkeletonLines';

export default function TicketWorkflow({ runId }: { runId: string }) {
  const create = useTicket();
  const approve = useApproveTicket();
  const creating = useRef(false);
  const approving = useRef(false);
  const exporting = useRef(false);
  const view = useRef<HTMLDivElement>(null);
  const creationFeedback = useRef<HTMLDivElement>(null);
  const approvalFeedback = useRef<HTMLDivElement>(null);
  const exportFeedback = useRef<HTMLDivElement>(null);
  const manualCopy = useRef<HTMLTextAreaElement>(null);
  const [manualMarkdown, setManualMarkdown] = useState<string | null>(null);
  const response = approve.data ?? create.data;
  const ticket = response?.run_id === runId ? response : undefined;
  const mismatch = response !== undefined && response.run_id !== runId;
  const approvalCode = approve.error instanceof AppError ? approve.error.code : normalizeApiError(approve.error)?.code;
  const approvalConflict = approvalCode === 'already_approved';

  useEffect(() => { if (ticket) view.current?.focus(); }, [ticket?.ticket_id]);
  useEffect(() => {
    if (create.isPending || create.isError) creationFeedback.current?.focus();
  }, [create.status]);
  useEffect(() => {
    if (approve.isError && !approvalConflict) approvalFeedback.current?.focus();
  }, [approve.status, approvalConflict]);

  function generate() {
    if (creating.current || ticket) return;
    creating.current = true;
    create.mutate(runId, { onSettled: () => { creating.current = false; } });
  }

  function recordApproval(name: string) {
    if (!ticket || ticket.status !== 'draft' || approvalConflict || approving.current || !name.trim()) return;
    approving.current = true;
    approve.mutate({ ticketId: ticket.ticket_id, analystName: name.trim() }, {
      onSettled: () => { approving.current = false; },
    });
  }

  const exportTicket = useMutation({
    mutationFn: async (action: 'copy' | 'download') => {
      if (!ticket) throw new Error('No current ticket');
      setManualMarkdown(null);
      const markdown = await apiClient.exportTicketMarkdown(ticket.ticket_id);
      if (action === 'copy') {
        try {
          if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
          await navigator.clipboard.writeText(markdown);
        } catch {
          setManualMarkdown(markdown);
          return 'manual-copy' as const;
        }
      } else downloadTicketMarkdown(ticket.ticket_id, markdown);
      return action;
    },
    retry: false,
  });

  useEffect(() => {
    if (exportTicket.isSuccess || exportTicket.isError) exportFeedback.current?.focus();
  }, [exportTicket.status]);

  function exportMarkdown(action: 'copy' | 'download') {
    if (exporting.current || approve.isPending) return;
    exporting.current = true;
    exportTicket.mutate(action, { onSettled: () => { exporting.current = false; } });
  }

  return (
    <section aria-label="Incident ticket" className="mt-6 rounded-2xl border border-outline/30 bg-panel p-5 shadow-sm sm:p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div><p className="mb-2 text-xs font-semibold tracking-[0.16em] text-muted">03 / INCIDENT TICKET</p><h2 className="text-lg font-semibold tracking-tight">Review and approve</h2></div>
        {ticket && <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => exportMarkdown('copy')} disabled={exportTicket.isPending || approve.isPending} className="button-secondary text-sm"><Copy size={15} aria-hidden="true" />{exportTicket.isPending && exportTicket.variables === 'copy' ? 'Copying Markdown…' : 'Copy Markdown'}</button>
          <button type="button" onClick={() => exportMarkdown('download')} disabled={exportTicket.isPending || approve.isPending} className="button-secondary text-sm"><Download size={15} aria-hidden="true" />{exportTicket.isPending && exportTicket.variables === 'download' ? 'Preparing Markdown…' : 'Download Markdown'}</button>
        </div>}
      </div>
      {!ticket ? <div>
        <p className="mb-4 text-sm leading-6 text-muted">Generate an incident ticket from this investigation, then review it before approval.</p>
        <button type="button" onClick={generate} disabled={create.isPending} className="button-primary justify-center py-3 text-sm">{create.isPending ? <LoaderCircle size={16} className="motion-safe:animate-spin" aria-hidden="true" /> : <FilePlus2 size={16} aria-hidden="true" />}{create.isPending ? 'Generating ticket…' : 'Generate Incident Ticket'}</button>
        {(create.isPending || create.isError) && <div ref={creationFeedback} tabIndex={-1} role="group" aria-label={create.isPending ? 'Ticket generation in progress' : 'Ticket generation needs attention'} className="focus-target mt-4 rounded-xl">
          {create.isPending ? <><p role="status" aria-live="polite" className="text-sm text-muted">Preparing the incident ticket…</p><SkeletonLines rows={2} /></> : <ErrorNotice error={create.error} onRetry={generate} retryLabel="Retry ticket generation" />}
        </div>}
        {mismatch && <p role="alert" className="mt-4 text-sm text-severity-critical">The ticket belongs to another investigation and cannot be shown here. Generate it again for this run.</p>}
      </div> : <>
        <div ref={exportFeedback} tabIndex={-1} className="focus-target mb-4 rounded-lg">
          <p role="status" aria-live="polite" className="text-sm text-muted">{exportTicket.isSuccess ? exportTicket.data === 'copy' ? 'Markdown copied to clipboard.' : exportTicket.data === 'manual-copy' ? 'Clipboard unavailable. Select the Markdown below to copy it, or use Download Markdown.' : 'Markdown download started.' : ''}</p>
          {manualMarkdown !== null && <div className="mt-3 rounded-xl border border-outline/40 bg-canvas/50 p-4">
            <label className="block text-sm font-medium">Markdown to copy<textarea ref={manualCopy} readOnly value={manualMarkdown} spellCheck={false} className="control mt-3 min-h-[200px] w-full resize-y p-3 font-mono text-xs leading-6" /></label>
            <button type="button" onClick={() => { manualCopy.current?.focus(); manualCopy.current?.select(); }} className="button-secondary mt-3 text-sm">Select Markdown</button>
          </div>}
          {exportTicket.isError && <ErrorNotice error={exportTicket.error} onRetry={() => exportMarkdown(exportTicket.variables ?? 'download')} retryLabel="Retry Markdown export" />}
        </div>
        {approve.isError && <div ref={approvalFeedback} tabIndex={-1} role="group" aria-label="Approval needs attention" className="focus-target mb-5 rounded-xl"><ErrorNotice error={approve.error} onRetry={() => { if (approve.variables) recordApproval(approve.variables.analystName); }} retryLabel="Retry approval" /></div>}
        <div ref={view} tabIndex={-1} role="group" aria-label="Incident ticket ready for review" className="focus-target rounded-xl"><TicketView ticket={ticket} approvalConflict={approvalConflict} /></div>
        <div className="mt-6 border-t border-outline/25 pt-5"><ApprovalBar key={ticket.ticket_id} ticket={ticket} onApprove={recordApproval} isApproving={approve.isPending} approvalConflict={approvalConflict} /></div>
      </>}
    </section>
  );
}
