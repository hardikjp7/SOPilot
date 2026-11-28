// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from './api';
import App from './App';
import { AppError } from './lib/errors';
import { approvedTicket, auditRows, draftTicket, groundedRun, lowConfidenceRun, noMatchRun, samples } from './mocks/fixtures';
import type { ApiErrorCode } from './api/types';

vi.mock('./api', () => ({ apiClient: { health: vi.fn(), samples: vi.fn(), run: vi.fn(), createTicket: vi.fn(), approve: vi.fn(), exportTicketMarkdown: vi.fn(), audit: vi.fn() } }));
const clients: QueryClient[] = [];
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { gcTime: Infinity } } });
  clients.push(client);
  return render(<QueryClientProvider client={client}><App /></QueryClientProvider>);
}

describe('app shell and intake integration', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    localStorage.clear();
    vi.mocked(apiClient.samples).mockResolvedValue(samples);
    vi.mocked(apiClient.health).mockResolvedValue({ status: 'ok', mock: true, index_chunks: 8 });
    vi.mocked(apiClient.run).mockResolvedValue(groundedRun);
    vi.mocked(apiClient.createTicket).mockResolvedValue(draftTicket);
    vi.mocked(apiClient.approve).mockResolvedValue(approvedTicket);
    vi.mocked(apiClient.audit).mockResolvedValue(auditRows);
  });
  afterEach(() => {
    cleanup();
    clients.splice(0).forEach((client) => client.clear());
  });

  it('shows the product, workspace, API health and accessible theme toggle', async () => {
    mount();
    expect(screen.getByText('SOPilot')).toBeTruthy();
    expect(screen.getByRole('main', { name: 'SOPilot workspace' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Start with an alert' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Your investigation starts here' })).toBeTruthy();
    await screen.findByText('Mock');
    expect(screen.getByText('8 chunks')).toBeTruthy();
    const toggle = screen.getByRole('button', { name: 'Light theme' });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('main').parentElement!.classList.contains('light')).toBe(true);
  });

  it('takes Live mode from useHealth rather than the environment flag', async () => {
    vi.mocked(apiClient.health).mockResolvedValue({ status: 'ok', mock: false, index_chunks: 37 });
    mount();
    await screen.findByText('Live');
    expect(screen.queryByText('Mock')).toBeNull();
    expect(screen.getByText('37 chunks')).toBeTruthy();
  });

  it('persists larger text and light theme without changing the current alert', async () => {
    const view = mount();
    const editor = screen.getByRole('textbox', { name: 'Alert JSON' }) as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: '{"message":"Keep this alert"}' } });
    const large = screen.getByRole('button', { name: 'Larger text' });
    expect(large.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(large);
    fireEvent.click(screen.getByRole('button', { name: 'Light theme' }));
    expect(large.getAttribute('aria-pressed')).toBe('true');
    expect(document.documentElement.dataset.textSize).toBe('large');
    expect(document.documentElement.classList.contains('light')).toBe(true);
    expect(editor.value).toContain('Keep this alert');
    view.unmount();
    mount();
    expect(screen.getByRole('button', { name: 'Larger text' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Light theme' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Larger text' }));
    expect(document.documentElement.dataset.textSize).toBe('standard');
  });

  it('keeps display controls usable when preference storage is blocked', () => {
    const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Unavailable'); });
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Unavailable'); });
    try {
      mount();
      fireEvent.click(screen.getByRole('button', { name: 'Larger text' }));
      fireEvent.click(screen.getByRole('button', { name: 'Light theme' }));
      expect(document.documentElement.dataset.textSize).toBe('large');
      expect(document.documentElement.classList.contains('light')).toBe(true);
    } finally { read.mockRestore(); write.mockRestore(); }
  });

  it('explains statuses and allows the character shortcut to be disabled persistently', async () => {
    const view = mount();
    await screen.findByRole('option', { name: samples[0]!.name });
    const guide = screen.getByText('Badge & status guide').closest('details')!;
    guide.open = true;
    expect(within(guide).getByText('No matching SOP')).toBeTruthy();
    expect(within(guide).getByText('Verified · Partial support')).toBeTruthy();
    const shortcut = within(guide).getByRole('checkbox', { name: 'Enable D demo shortcut' }) as HTMLInputElement;
    expect(shortcut.checked).toBe(true);
    fireEvent.click(shortcut);
    fireEvent.keyDown(document.body, { key: 'd' });
    expect(apiClient.run).not.toHaveBeenCalled();
    view.unmount();
    mount();
    await screen.findByRole('option', { name: samples[0]!.name });
    fireEvent.keyDown(document.body, { key: 'd' });
    expect(apiClient.run).not.toHaveBeenCalled();
  });

  it('moves focus through pending analysis, results, draft review and approval', async () => {
    let finishRun!: (value: typeof groundedRun) => void;
    vi.mocked(apiClient.run).mockReturnValueOnce(new Promise((resolve) => { finishRun = resolve; }));
    mount();
    fireEvent.change(screen.getByRole('textbox', { name: 'Alert JSON' }), { target: { value: '{}' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run analysis' }));
    const pending = await screen.findByRole('group', { name: 'Analysis in progress' });
    await waitFor(() => expect(document.activeElement).toBe(pending));
    expect(pending.querySelector('[aria-hidden="true"].motion-safe\\:animate-pulse')).toBeTruthy();
    finishRun(groundedRun);
    const result = await screen.findByRole('group', { name: 'Analysis ready for review' });
    await waitFor(() => expect(document.activeElement).toBe(result));
    fireEvent.click(screen.getByRole('button', { name: 'Generate Incident Ticket' }));
    const ticket = await screen.findByRole('group', { name: 'Incident ticket ready for review' });
    await waitFor(() => expect(document.activeElement).toBe(ticket));
    const name = screen.getByRole('textbox', { name: /Analyst name/ });
    name.focus();
    fireEvent.change(name, { target: { value: 'Demo Analyst' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Approve incident ticket' }));
    const approved = (await screen.findByText('Approved · read-only')).closest('[role="status"]');
    await waitFor(() => expect(document.activeElement).toBe(approved));
    expect(screen.queryByRole('textbox', { name: /Analyst name/ })).toBeNull();
  });

  it('focuses analysis errors and does not steal focus when results arrive in the Audit tab', async () => {
    let finishRun!: (value: typeof groundedRun) => void;
    vi.mocked(apiClient.run).mockRejectedValueOnce(new AppError('llm_unavailable'))
      .mockReturnValueOnce(new Promise((resolve) => { finishRun = resolve; }));
    mount();
    fireEvent.change(screen.getByRole('textbox', { name: 'Alert JSON' }), { target: { value: '{}' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run analysis' }));
    const error = await screen.findByRole('group', { name: 'Analysis needs attention' });
    await waitFor(() => expect(document.activeElement).toBe(error));
    fireEvent.click(screen.getByRole('button', { name: 'Retry analysis' }));
    await screen.findByRole('group', { name: 'Analysis in progress' });
    const audit = screen.getByRole('tab', { name: 'Audit' });
    audit.focus();
    fireEvent.click(audit);
    finishRun(groundedRun);
    await screen.findByText('5,860 ms');
    expect(document.activeElement).toBe(audit);
    fireEvent.click(screen.getByRole('tab', { name: 'Workspace' }));
    expect(document.activeElement).not.toBe(screen.getByRole('group', { name: 'Analysis ready for review' }));
  });
  it('shows health loading without guessing Mock or Live', () => {
    vi.mocked(apiClient.health).mockReturnValue(new Promise(() => {}));
    mount();
    expect(screen.getByText('Connecting…')).toBeTruthy();
    expect(screen.queryByText('Mock')).toBeNull();
    expect(screen.queryByText('Live')).toBeNull();
  });
  it('handles a health failure with a retry action', async () => {
    vi.mocked(apiClient.health).mockRejectedValueOnce(new Error('Offline'));
    mount();
    await screen.findByText('Service unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Retry health' }));
    await screen.findByText('Mock');
    expect(apiClient.health).toHaveBeenCalledTimes(2);
  });
  it('runs the useRun mutation with the parsed alert and displays the response', async () => {
    mount();
    const alert = { source: 'test', message: 'Raw alert' };
    fireEvent.change(screen.getByRole('textbox', { name: 'Alert JSON' }), { target: { value: JSON.stringify(alert) } });
    fireEvent.click(screen.getByRole('button', { name: 'Run analysis' }));
    await waitFor(() => expect(apiClient.run).toHaveBeenCalledExactlyOnceWith(alert));
    await screen.findByText('Analysis received');
    expect(screen.getByText(groundedRun.parsed.summary)).toBeTruthy();
    expect(screen.getByText(groundedRun.run_id)).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Parsed alert' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Analysis pipeline' })).toBeTruthy();
    expect(screen.getByText('Total 5,860 ms')).toBeTruthy();
    expect(screen.getByRole('meter').getAttribute('aria-valuenow')).toBe('0.96');
    expect(within(screen.getByRole('list', { name: 'Containment steps' })).getAllByRole('listitem')).toHaveLength(6);
    expect(screen.getByRole('button', { name: 'View source for PB-RAN-02' })).toBeTruthy();
  });
  it('does not start a mutation for invalid input', () => {
    mount();
    fireEvent.change(screen.getByRole('textbox', { name: 'Alert JSON' }), { target: { value: 'null' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run analysis' }));
    expect(apiClient.run).not.toHaveBeenCalled();
  });

  it('has an empty Audit tab before a run without requesting audit data', () => {
    mount();
    fireEvent.click(screen.getByRole('tab', { name: 'Audit' }));
    expect(screen.getByRole('tabpanel', { name: 'Audit' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'No run yet' })).toBeTruthy();
    expect(screen.getByText('No timings yet. Run an alert to see the reported durations.')).toBeTruthy();
    expect(apiClient.audit).not.toHaveBeenCalled();
  });

  it('supports arrow, Home and End navigation between tabs', () => {
    mount();
    const workspace = screen.getByRole('tab', { name: 'Workspace' });
    const audit = screen.getByRole('tab', { name: 'Audit' });
    fireEvent.keyDown(workspace, { key: 'ArrowRight' });
    expect(audit.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(audit);
    fireEvent.keyDown(audit, { key: 'ArrowLeft' });
    expect(workspace.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(workspace, { key: 'End' });
    expect(audit.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(audit, { key: 'Home' });
    expect(workspace.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(workspace);
  });

  it('loads the selected run audit and lets the user expand details', async () => {
    mount();
    fireEvent.change(screen.getByRole('textbox', { name: 'Alert JSON' }), { target: { value: '{}' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run analysis' }));
    await screen.findByText('Analysis received');
    expect(apiClient.audit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('tab', { name: 'Audit' }));
    const panel = screen.getByRole('tabpanel', { name: 'Audit' });
    await within(panel).findByRole('table', { name: `Audit records for ${groundedRun.run_id}` });
    expect(apiClient.audit).toHaveBeenCalledExactlyOnceWith(groundedRun.run_id);
    expect(screen.getByRole('region', { name: 'Run timings' })).toBeTruthy();
    fireEvent.click(within(panel).getByRole('button', { name: 'Show details for verify audit row 4' }));
    expect(within(panel).getByRole('region', { name: 'Formatted details for verify audit row 4' }).textContent).toBe(JSON.stringify(auditRows[3]!.details_json, null, 2));
  });

  it('preserves an unfinished analyst name when switching to Audit and back', async () => {
    mount();
    fireEvent.change(screen.getByRole('textbox', { name: 'Alert JSON' }), { target: { value: '{}' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run analysis' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Generate Incident Ticket' }));
    const name = await screen.findByRole('textbox', { name: /Analyst name/ });
    fireEvent.change(name, { target: { value: 'Analyst in progress' } });
    fireEvent.click(screen.getByRole('tab', { name: 'Audit' }));
    await screen.findByRole('table');
    expect(screen.queryByRole('textbox', { name: /Analyst name/ })).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Workspace' }));
    expect((screen.getByRole('textbox', { name: /Analyst name/ }) as HTMLInputElement).value).toBe('Analyst in progress');
    expect(apiClient.createTicket).toHaveBeenCalledOnce();
  });

  it('exposes ticket generation after a checklist exists and completes approval', async () => {
    mount();
    expect(screen.queryByRole('button', { name: 'Generate Incident Ticket' })).toBeNull();
    fireEvent.change(screen.getByRole('textbox', { name: 'Alert JSON' }), { target: { value: '{}' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run analysis' }));
    const generate = await screen.findByRole('button', { name: 'Generate Incident Ticket' });
    fireEvent.click(generate);
    const ticketRegion = screen.getByRole('region', { name: 'Incident ticket' });
    await within(ticketRegion).findByRole('heading', { name: draftTicket.title });
    expect(apiClient.createTicket).toHaveBeenCalledExactlyOnceWith(groundedRun.run_id);
    fireEvent.change(within(ticketRegion).getByRole('textbox', { name: /Analyst name/ }), { target: { value: 'Demo Analyst' } });
    fireEvent.click(within(ticketRegion).getByRole('button', { name: 'Approve ticket' }));
    await within(ticketRegion).findByText('Approved · read-only');
    expect(within(ticketRegion).queryByRole('textbox')).toBeNull();
    expect(within(ticketRegion).getByText(approvedTicket.approved_at!)).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Alert JSON' })).toBeTruthy();
  });
  it('keeps the form disabled and prevents duplicate D runs while pending', async () => {
    vi.mocked(apiClient.run).mockReturnValue(new Promise(() => {}));
    mount();
    await screen.findByRole('option', { name: samples[0]!.name });
    fireEvent.keyDown(document.body, { key: 'd' });
    fireEvent.keyDown(document.body, { key: 'd' });
    await waitFor(() => expect(apiClient.run).toHaveBeenCalledExactlyOnceWith(samples[0]!.alert));
    expect((screen.getByRole('button', { name: 'Running analysis…' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).disabled).toBe(true);
    expect(screen.getByText('Analyzing your alert')).toBeTruthy();
    expect(screen.getByText('Waiting for parsed alert…')).toBeTruthy();
    expect(screen.getByText('Parse (simulated). Awaiting server response.')).toBeTruthy();
  });
  it('retries the last submitted alert after a typed API error', async () => {
    vi.mocked(apiClient.run).mockRejectedValueOnce(new AppError('llm_unavailable'));
    mount();
    const alert = { message: 'Original alert' };
    const editor = screen.getByRole('textbox', { name: 'Alert JSON' });
    fireEvent.change(editor, { target: { value: JSON.stringify(alert) } });
    fireEvent.click(screen.getByRole('button', { name: 'Run analysis' }));
    await screen.findByText('The analysis service is temporarily unavailable. Please retry.');
    expect(screen.getByText('Analysis failed. The service did not report which stage failed.')).toBeTruthy();
    expect(screen.queryByRole('meter')).toBeNull();
    fireEvent.change(editor, { target: { value: '{"message":"Edited after failure"}' } });
    fireEvent.click(screen.getByRole('button', { name: 'Retry analysis' }));
    await screen.findByText('Analysis received');
    expect(apiClient.run).toHaveBeenNthCalledWith(2, alert);
  });

  it.each([
    ['invalid_json', 'The alert is not valid JSON. Check the input and try again.'],
    ['payload_too_large', 'The alert is too large. Reduce it to 200 KB or less.'],
    ['validation_error', 'Some information is missing or invalid. Check your input and try again.'],
    ['not_found', 'The requested item could not be found. Check your selection and try again.'],
    ['already_approved', 'This ticket has already been approved and is read-only.'],
    ['llm_unavailable', 'The analysis service is temporarily unavailable. Please retry.'],
  ] satisfies [ApiErrorCode, string][])('shows a safe UI notice for mutation error %s', async (code, message) => {
    vi.mocked(apiClient.run).mockRejectedValueOnce(new AppError(code, { body: 'RAW RESPONSE BODY' }));
    const { container } = mount();
    fireEvent.change(screen.getByRole('textbox', { name: 'Alert JSON' }), { target: { value: '{}' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run analysis' }));
    await screen.findByText(message);
    expect(apiClient.run).toHaveBeenCalledExactlyOnceWith({});
    expect(container.textContent).not.toContain('RAW RESPONSE BODY');
  });

  it.each(['invalid_json', 'payload_too_large'] satisfies ApiErrorCode[])('returns focus to the editable JSON input for %s', async (code) => {
    vi.mocked(apiClient.run).mockRejectedValueOnce(new AppError(code));
    mount();
    const input = screen.getByRole('textbox', { name: 'Alert JSON' }) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: '{"source":"test"}' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run analysis' }));
    const review = await screen.findByRole('button', { name: 'Review alert input' });
    fireEvent.click(review);
    expect(document.activeElement).toBe(input);
    expect(input.disabled).toBe(false);
    expect(input.value).toBe('{"source":"test"}');
    expect(screen.queryByRole('button', { name: 'Retry analysis' })).toBeNull();
    expect(apiClient.run).toHaveBeenCalledOnce();
  });

  it('does not show an unknown error body in the app', async () => {
    vi.mocked(apiClient.run).mockRejectedValueOnce(new Error('RAW INTERNAL RESPONSE BODY'));
    const { container } = mount();
    fireEvent.change(screen.getByRole('textbox', { name: 'Alert JSON' }), { target: { value: '{}' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run analysis' }));
    await screen.findByText('The request could not be completed. Check your connection and try again.');
    expect(container.textContent).not.toContain('RAW INTERNAL RESPONSE BODY');
  });

  it('prevents duplicate retry mutations while the retried request is pending', async () => {
    vi.mocked(apiClient.run).mockRejectedValueOnce(new AppError('llm_unavailable'))
      .mockReturnValueOnce(new Promise(() => {}));
    mount();
    fireEvent.change(screen.getByRole('textbox', { name: 'Alert JSON' }), { target: { value: '{"message":"original"}' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run analysis' }));
    const retry = await screen.findByRole('button', { name: 'Retry analysis' });
    fireEvent.click(retry);
    fireEvent.click(retry);
    await waitFor(() => expect(apiClient.run).toHaveBeenCalledTimes(2));
    expect(apiClient.run).toHaveBeenNthCalledWith(2, { message: 'original' });
    expect((screen.getByRole('button', { name: 'Running analysis…' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it.each([
    [lowConfidenceRun, 'Low confidence: manual review required', 2],
    [noMatchRun, 'Escalate: no matching SOP', 0],
  ] as const)('renders returned checklist status $0.checklist.status without changing the kept steps', async (response, title, count) => {
    vi.mocked(apiClient.run).mockResolvedValueOnce(response);
    mount();
    fireEvent.change(screen.getByRole('textbox', { name: 'Alert JSON' }), { target: { value: '{}' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run analysis' }));
    await screen.findByRole('heading', { name: title });
    expect(screen.getByText(response.checklist.escalation_note)).toBeTruthy();
    if (count) expect(within(screen.getByRole('list', { name: 'Containment steps' })).getAllByRole('listitem')).toHaveLength(count);
    else expect(screen.queryByRole('list', { name: 'Containment steps' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry analysis' })).toBeNull();
  });
});
