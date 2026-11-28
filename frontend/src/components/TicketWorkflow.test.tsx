// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../api';
import { AppError } from '../lib/errors';
import { approvedTicket, draftTicket, noMatchRun } from '../mocks/fixtures';
import { draftTicketFixtures } from '../mocks/ticketFixtures';
import TicketWorkflow from './TicketWorkflow';

vi.mock('../api', () => ({ apiClient: { createTicket: vi.fn(), approve: vi.fn(), exportTicketMarkdown: vi.fn() } }));
const clients: QueryClient[] = [];
const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
const createUrlDescriptor = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
const revokeUrlDescriptor = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');
const writeText = vi.fn<(value: string) => Promise<void>>();
const createUrl = vi.fn();
const revokeUrl = vi.fn();
let downloadedName = '';
let downloadedBlob: Blob | undefined;

function mount(runId = draftTicket.run_id) {
  const client = new QueryClient({ defaultOptions: { mutations: { gcTime: Infinity } } });
  clients.push(client);
  return render(<QueryClientProvider client={client}><TicketWorkflow runId={runId} /></QueryClientProvider>);
}

async function generate() {
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Generate Incident Ticket' }));
  await screen.findByRole('heading', { name: draftTicket.title });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(apiClient.createTicket).mockResolvedValue(draftTicket);
  vi.mocked(apiClient.approve).mockResolvedValue(approvedTicket);
  vi.mocked(apiClient.exportTicketMarkdown).mockResolvedValue('# SERVER MARKDOWN\n\nExact export content.\n');
  writeText.mockResolvedValue();
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  downloadedName = '';
  downloadedBlob = undefined;
  createUrl.mockImplementation((blob: Blob) => { downloadedBlob = blob; return 'blob:ticket-download'; });
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createUrl });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeUrl });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { downloadedName = this.download; });
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor); else Reflect.deleteProperty(navigator, 'clipboard');
  if (createUrlDescriptor) Object.defineProperty(URL, 'createObjectURL', createUrlDescriptor); else Reflect.deleteProperty(URL, 'createObjectURL');
  if (revokeUrlDescriptor) Object.defineProperty(URL, 'revokeObjectURL', revokeUrlDescriptor); else Reflect.deleteProperty(URL, 'revokeObjectURL');
  vi.restoreAllMocks();
});

describe('ticket generation, approval and export', () => {
  it('announces generation with decorative placeholders and focuses the draft when ready', async () => {
    let finish!: (ticket: typeof draftTicket) => void;
    vi.mocked(apiClient.createTicket).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Generate Incident Ticket' }));
    const pending = await screen.findByRole('group', { name: 'Ticket generation in progress' });
    expect(within(pending).getByRole('status').textContent).toBe('Preparing the incident ticket…');
    await waitFor(() => expect(document.activeElement).toBe(pending));
    await act(async () => finish(draftTicket));
    const view = await screen.findByRole('group', { name: 'Incident ticket ready for review' });
    await waitFor(() => expect(document.activeElement).toBe(view));
    expect(screen.queryByRole('group', { name: 'Ticket generation in progress' })).toBeNull();
  });

  it('calls createTicket only when Generate is requested, then completes a draft-to-approved flow', async () => {
    mount();
    expect(apiClient.createTicket).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Generate Incident Ticket' }));
    await screen.findByRole('heading', { name: draftTicket.title });
    expect(apiClient.createTicket).toHaveBeenCalledExactlyOnceWith(draftTicket.run_id);
    fireEvent.change(screen.getByRole('textbox', { name: /Analyst name/ }), { target: { value: 'Demo Analyst' } });
    fireEvent.click(screen.getByRole('button', { name: 'Approve ticket' }));
    await screen.findByText('Approved · read-only');
    expect(apiClient.approve).toHaveBeenCalledExactlyOnceWith(draftTicket.ticket_id, 'Demo Analyst');
    expect(screen.getByText(approvedTicket.approved_by!)).toBeTruthy();
    expect(screen.getByText(approvedTicket.approved_at!)).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Approve ticket' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Download Markdown' })).toBeTruthy();
  });

  it('blocks empty/whitespace analyst names without calling approve', async () => {
    await generate();
    fireEvent.change(screen.getByRole('textbox', { name: /Analyst name/ }), { target: { value: '  ' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Approve incident ticket' }));
    expect(apiClient.approve).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: 'Approve ticket' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('prevents double approval clicks while the request is pending', async () => {
    let resolve!: (value: typeof approvedTicket) => void;
    vi.mocked(apiClient.approve).mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    await generate();
    fireEvent.change(screen.getByRole('textbox', { name: /Analyst name/ }), { target: { value: 'Demo Analyst' } });
    const button = screen.getByRole('button', { name: 'Approve ticket' });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(apiClient.approve).toHaveBeenCalledOnce());
    expect((screen.getByRole('textbox') as HTMLInputElement).disabled).toBe(true);
    await act(async () => resolve(approvedTicket));
    await screen.findByText('Approved · read-only');
    fireEvent.click(button);
    expect(apiClient.approve).toHaveBeenCalledOnce();
  });

  it('handles already_approved gracefully and removes all approval controls', async () => {
    vi.mocked(apiClient.approve).mockRejectedValueOnce(new AppError('already_approved'));
    await generate();
    fireEvent.change(screen.getByRole('textbox', { name: /Analyst name/ }), { target: { value: 'Other analyst' } });
    fireEvent.click(screen.getByRole('button', { name: 'Approve ticket' }));
    await screen.findByRole('heading', { name: 'Ticket already approved' });
    expect(screen.getByText('Approval recorded · read-only snapshot')).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Approve ticket' })).toBeNull();
    expect(screen.queryByText(approvedTicket.approved_by!)).toBeNull();
    expect(screen.queryByText(approvedTicket.approved_at!)).toBeNull();
    expect(apiClient.approve).toHaveBeenCalledOnce();
  });

  it('copies exact server-exported Markdown instead of reconstructing the ticket in the UI', async () => {
    await generate();
    fireEvent.click(screen.getByRole('button', { name: 'Copy Markdown' }));
    await screen.findByText('Markdown copied to clipboard.');
    expect(document.activeElement?.textContent).toBe('Markdown copied to clipboard.');
    expect(apiClient.exportTicketMarkdown).toHaveBeenCalledExactlyOnceWith(draftTicket.ticket_id);
    expect(writeText).toHaveBeenCalledExactlyOnceWith('# SERVER MARKDOWN\n\nExact export content.\n');
  });

  it('downloads the exact Markdown response as a correctly named UTF-8 file', async () => {
    await generate();
    fireEvent.click(screen.getByRole('button', { name: 'Download Markdown' }));
    await screen.findByText('Markdown download started.');
    expect(apiClient.exportTicketMarkdown).toHaveBeenCalledExactlyOnceWith(draftTicket.ticket_id);
    expect(downloadedName).toBe(`${draftTicket.ticket_id}.md`);
    expect(downloadedBlob!.type).toBe('text/markdown;charset=utf-8');
    const content = await new Promise((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsText(downloadedBlob!); });
    expect(content).toBe('# SERVER MARKDOWN\n\nExact export content.\n');
    expect(document.querySelector('a[download]')).toBeNull();
  });

  it.each(['denied', 'missing'])('offers exact, selectable Markdown when clipboard access is %s', async (mode) => {
    if (mode === 'missing') Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    else writeText.mockRejectedValueOnce(new DOMException('Denied', 'NotAllowedError'));
    await generate();
    fireEvent.click(screen.getByRole('button', { name: 'Copy Markdown' }));
    await screen.findByText('Clipboard unavailable. Select the Markdown below to copy it, or use Download Markdown.');
    const copy = screen.getByRole('textbox', { name: 'Markdown to copy' }) as HTMLTextAreaElement;
    expect(copy.readOnly).toBe(true);
    expect(copy.value).toBe('# SERVER MARKDOWN\n\nExact export content.\n');
    fireEvent.click(screen.getByRole('button', { name: 'Select Markdown' }));
    expect(document.activeElement).toBe(copy);
    expect(copy.selectionStart).toBe(0);
    expect(copy.selectionEnd).toBe(copy.value.length);
    expect(screen.queryByRole('heading', { name: 'Request unavailable' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Download Markdown' }));
    await screen.findByText('Markdown download started.');
    expect(screen.queryByRole('textbox', { name: 'Markdown to copy' })).toBeNull();
    expect(apiClient.approve).not.toHaveBeenCalled();
  });

  it('exports again after approval using the current server version', async () => {
    await generate();
    fireEvent.change(screen.getByRole('textbox', { name: /Analyst name/ }), { target: { value: 'Demo Analyst' } });
    fireEvent.click(screen.getByRole('button', { name: 'Approve ticket' }));
    await screen.findByText('Approved · read-only');
    vi.mocked(apiClient.exportTicketMarkdown).mockResolvedValueOnce('# Approved server ticket\nDemo Analyst');
    fireEvent.click(screen.getByRole('button', { name: 'Copy Markdown' }));
    await screen.findByText('Markdown copied to clipboard.');
    expect(writeText).toHaveBeenCalledExactlyOnceWith('# Approved server ticket\nDemo Analyst');
  });

  it('offers a manual retry for a failed export without retrying approval', async () => {
    vi.mocked(apiClient.exportTicketMarkdown).mockRejectedValueOnce(new AppError('llm_unavailable'));
    await generate();
    fireEvent.click(screen.getByRole('button', { name: 'Download Markdown' }));
    const retry = await screen.findByRole('button', { name: 'Retry Markdown export' });
    expect(document.activeElement?.contains(retry)).toBe(true);
    expect(apiClient.exportTicketMarkdown).toHaveBeenCalledOnce();
    fireEvent.click(retry);
    await screen.findByText('Markdown download started.');
    expect(apiClient.exportTicketMarkdown).toHaveBeenCalledTimes(2);
    expect(apiClient.approve).not.toHaveBeenCalled();
  });

  it('shows a generation error and retries createTicket only when requested', async () => {
    vi.mocked(apiClient.createTicket).mockRejectedValueOnce(new AppError('llm_unavailable'));
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Generate Incident Ticket' }));
    const retry = await screen.findByRole('button', { name: 'Retry ticket generation' });
    expect(document.activeElement).toBe(screen.getByRole('group', { name: 'Ticket generation needs attention' }));
    expect(apiClient.createTicket).toHaveBeenCalledOnce();
    fireEvent.click(retry);
    await screen.findByRole('heading', { name: draftTicket.title });
    expect(apiClient.createTicket).toHaveBeenCalledTimes(2);
  });

  it('does not display a ticket returned for a different run', async () => {
    mount('RUN-other');
    fireEvent.click(screen.getByRole('button', { name: 'Generate Incident Ticket' }));
    await screen.findByRole('alert');
    expect(screen.queryByRole('heading', { name: draftTicket.title })).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('generates an escalation-only ticket for a no-match checklist', async () => {
    const ticket = draftTicketFixtures.find((item) => item.run_id === noMatchRun.run_id)!;
    vi.mocked(apiClient.createTicket).mockResolvedValueOnce(ticket);
    mount(noMatchRun.run_id);
    fireEvent.click(screen.getByRole('button', { name: 'Generate Incident Ticket' }));
    await screen.findByRole('heading', { name: ticket.title });
    expect(apiClient.createTicket).toHaveBeenCalledExactlyOnceWith(noMatchRun.run_id);
    expect(screen.getByText(noMatchRun.checklist.escalation_note)).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Containment actions' })).queryByRole('list')).toBeNull();
    expect(screen.getByRole('button', { name: 'Approve ticket' })).toBeTruthy();
  });
});
