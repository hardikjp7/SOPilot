// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../api';
import { MAX_ALERT_BYTES } from '../lib/validateAlertJson';
import { samples } from '../mocks/fixtures';
import AlertInput from './AlertInput';

vi.mock('../api', () => ({ apiClient: { samples: vi.fn() } }));
const clients: QueryClient[] = [];
function mount(isRunning = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  clients.push(client);
  const onRun = vi.fn();
  const view = render(<QueryClientProvider client={client}><AlertInput onRun={onRun} isRunning={isRunning} /></QueryClientProvider>);
  return { ...view, onRun };
}
async function ready() {
  const view = mount();
  await screen.findByRole('option', { name: samples[0]!.name });
  return view;
}
const editor = () => screen.getByRole('textbox', { name: 'Alert JSON' }) as HTMLTextAreaElement;
const runButton = () => screen.getByRole('button', { name: 'Run analysis' }) as HTMLButtonElement;

describe('AlertInput', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(apiClient.samples).mockResolvedValue(samples);
  });
  afterEach(() => {
    cleanup();
    clients.splice(0).forEach((client) => client.clear());
  });
  it('starts empty with Run disabled and accessible instructions', async () => {
    await ready();
    expect(runButton().disabled).toBe(true);
    expect(editor().value).toBe('');
    expect(editor().getAttribute('aria-describedby')).toBeTruthy();
    expect(screen.getByText('Add an alert to enable analysis.')).toBeTruthy();
  });
  it('validates JSON live and blocks invalid submission', async () => {
    const { onRun } = await ready();
    fireEvent.change(editor(), { target: { value: '{ invalid' } });
    expect(screen.getByText(/Invalid JSON/)).toBeTruthy();
    expect(editor().getAttribute('aria-invalid')).toBe('true');
    expect(runButton().disabled).toBe(true);
    fireEvent.submit(editor().closest('form')!);
    expect(onRun).not.toHaveBeenCalled();
    fireEvent.change(editor(), { target: { value: '{}' } });
    expect(editor().getAttribute('aria-invalid')).toBe('false');
    expect(runButton().disabled).toBe(false);
  });
  it.each(['[]', 'null', '23', '"text"'])('blocks a non-object JSON root: %s', async (value) => {
    await ready();
    fireEvent.change(editor(), { target: { value } });
    expect(runButton().disabled).toBe(true);
    expect(screen.getByText(/Enter a JSON object/)).toBeTruthy();
  });
  it('shows an inline oversize error and disables Run', async () => {
    const { onRun } = await ready();
    fireEvent.change(editor(), { target: { value: JSON.stringify({ message: 'x'.repeat(MAX_ALERT_BYTES) }) } });
    expect(screen.getByText(/exceeds the 200 KB limit/)).toBeTruthy();
    expect(runButton().disabled).toBe(true);
    fireEvent.submit(editor().closest('form')!);
    expect(onRun).not.toHaveBeenCalled();
  });
  it('populates the picker from samples(), fills the editor and runs only on submit', async () => {
    const { onRun } = await ready();
    expect(apiClient.samples).toHaveBeenCalledOnce();
    expect(screen.getAllByRole('option')).toHaveLength(samples.length + 1);
    fireEvent.change(screen.getByRole('combobox', { name: 'Sample alert' }), { target: { value: samples[1]!.id } });
    expect(editor().value).toBe(JSON.stringify(samples[1]!.alert, null, 2));
    expect(document.activeElement).toBe(editor());
    expect(runButton().disabled).toBe(false);
    expect(onRun).not.toHaveBeenCalled();
    fireEvent.click(runButton());
    expect(onRun).toHaveBeenCalledExactlyOnceWith(samples[1]!.alert);
  });
  it('submits pasted data unchanged and clears sample selection on edit', async () => {
    const { onRun } = await ready();
    const select = screen.getByRole('combobox', { name: 'Sample alert' }) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: samples[0]!.id } });
    const alert = { source: 'Custom', nested: { event: 'test' } };
    fireEvent.change(editor(), { target: { value: JSON.stringify(alert) } });
    expect(select.value).toBe('');
    fireEvent.click(runButton());
    expect(onRun).toHaveBeenCalledExactlyOnceWith(alert);
  });
  it.each(['d', 'D'])('loads the ransomware sample and runs it with the %s shortcut', async (key) => {
    const { onRun } = await ready();
    fireEvent.keyDown(document.body, { key });
    expect(editor().value).toBe(JSON.stringify(samples[0]!.alert, null, 2));
    expect(onRun).toHaveBeenCalledExactlyOnceWith(samples[0]!.alert);
  });
  it('does not capture typing in editors, selectors or contenteditable elements', async () => {
    const { onRun } = await ready();
    fireEvent.keyDown(editor(), { key: 'd' });
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'd' });
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    document.body.append(editable);
    fireEvent.keyDown(editable, { key: 'd' });
    editable.remove();
    expect(onRun).not.toHaveBeenCalled();
    expect(editor().value).toBe('');
  });
  it('ignores modified, composing or repeated shortcut keys', async () => {
    const { onRun } = await ready();
    for (const modifier of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { repeat: true }, { isComposing: true }]) {
      fireEvent.keyDown(document.body, { key: 'd', ...modifier });
    }
    expect(onRun).not.toHaveBeenCalled();
  });
  it('blocks editing and the shortcut during an active run', async () => {
    const { onRun } = mount(true);
    await screen.findByRole('option', { name: samples[0]!.name });
    expect(editor().disabled).toBe(true);
    expect((screen.getByRole('combobox') as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Running analysis…' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(document.body, { key: 'd' });
    expect(onRun).not.toHaveBeenCalled();
  });
  it('allows pasted input during sample loading but waits to enable the shortcut', () => {
    vi.mocked(apiClient.samples).mockReturnValue(new Promise(() => {}));
    const { onRun } = mount();
    expect((screen.getByRole('combobox') as HTMLSelectElement).disabled).toBe(true);
    fireEvent.keyDown(document.body, { key: 'd' });
    expect(onRun).not.toHaveBeenCalled();
    fireEvent.change(editor(), { target: { value: '{}' } });
    expect(runButton().disabled).toBe(false);
  });
  it('handles an empty sample list without blocking pasted input', async () => {
    vi.mocked(apiClient.samples).mockResolvedValue([]);
    mount();
    await screen.findByText(/No sample alerts are available/);
    fireEvent.change(editor(), { target: { value: '{}' } });
    expect(runButton().disabled).toBe(false);
  });
  it('offers sample retry after an error', async () => {
    vi.mocked(apiClient.samples).mockRejectedValueOnce(new Error('Offline'));
    mount();
    await screen.findByText(/Samples could not be loaded/);
    fireEvent.change(editor(), { target: { value: '{}' } });
    expect(runButton().disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Retry samples' }));
    await screen.findByRole('option', { name: samples[0]!.name });
    await waitFor(() => expect(apiClient.samples).toHaveBeenCalledTimes(2));
  });
  it('removes the shortcut listener when unmounted', async () => {
    const { onRun, unmount } = await ready();
    unmount();
    fireEvent.keyDown(document.body, { key: 'd' });
    expect(onRun).not.toHaveBeenCalled();
  });
  it('renders untrusted sample strings as text', async () => {
    vi.mocked(apiClient.samples).mockResolvedValue([{ id: 'untrusted', name: '<img src=x onerror=alert(1)>', alert: { message: '<script>alert(1)</script>' } }]);
    mount();
    await screen.findByRole('option', { name: '<img src=x onerror=alert(1)>' });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'untrusted' } });
    expect(editor().value).toContain('<script>');
    expect(document.querySelector('img, script')).toBeNull();
  });
});
