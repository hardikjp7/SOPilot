import { expect, test } from '@playwright/test';
import type { Page, Response } from '@playwright/test';
import type { AuditRow, HealthResponse, IncidentTicket, RunResponse } from '../src/api/types';

const apiBaseURL = process.env.VITE_API_BASE_URL!;
const diagnostics = new WeakMap<Page, string[]>();
const isResponse = (method: string, endpoint: string) => (response: Response) =>
  response.request().method() === method && response.url().split('?')[0] === `${apiBaseURL}${endpoint}`;

async function body<T>(response: Response): Promise<T> {
  expect(response.status(), 'API request must succeed (response bodies are not logged)').toBe(200);
  return response.json() as Promise<T>;
}

async function runSample(page: Page, label: string): Promise<RunResponse> {
  await page.getByLabel('Sample alert', { exact: true }).selectOption({ label });
  const response = page.waitForResponse(isResponse('POST', '/run'), { timeout: 40_000 });
  await page.getByRole('button', { name: 'Run analysis', exact: true }).click();
  const run = await body<RunResponse>(await response);
  await expect(page.getByRole('group', { name: 'Analysis ready for review', exact: true })).toContainText(run.run_id);
  return run;
}

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  diagnostics.set(page, errors);
  // Record categories and paths only; never console payloads, headers, or bodies.
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push('Browser console error');
    if (message.type() === 'warning' && message.text().includes('[SOPilot contract')) errors.push('Contract warning');
  });
  page.on('pageerror', () => errors.push('Uncaught browser error'));
  page.on('requestfailed', (request) => errors.push(`Failed request: ${new URL(request.url()).pathname}`));
  page.on('response', (response) => {
    if (response.status() >= 400) errors.push(`HTTP ${response.status()}: ${new URL(response.url()).pathname}`);
  });
  const response = page.waitForResponse(isResponse('GET', '/health'));
  await page.goto('/');
  const health = await body<HealthResponse>(await response);
  expect(health.status).toBe('ok');
  expect(health.mock, 'This suite requires the real backend').toBe(false);
  expect(health.index_chunks).toBeGreaterThan(0);
  await expect(page.getByRole('status', { name: 'Backend health' })).toContainText('Live');
  await expect(page.getByLabel('Sample alert', { exact: true })).toBeEnabled();
});

test.afterEach(async ({ page }) => {
  expect(diagnostics.get(page), 'No browser errors, failed requests, or contract warnings').toEqual([]);
});

test('ransomware: grounded citations, approved ticket, and one audit row per stage', async ({ page }) => {
  const run = await runSample(page, 'Ransomware');
  expect(run.checklist.status).toBe('grounded');
  expect(run.checklist.steps.length).toBeGreaterThanOrEqual(3);
  const checklist = page.getByRole('region', { name: 'Containment checklist', exact: true });
  await expect(checklist.getByText('Grounded', { exact: true })).toBeVisible();
  const chips = checklist.getByRole('list', { name: 'Containment steps' }).getByRole('button', { name: /^View source for / });
  await expect(chips).toHaveCount(run.checklist.steps.length);
  const first = run.checklist.steps[0];
  if (!first) throw new Error('Grounded checklist has no source');
  await chips.first().click();
  await expect(page.getByRole('dialog', { name: 'Playbook citation' })).toBeVisible();
  expect(await page.getByRole('region', { name: 'Exact playbook source' }).textContent()).toBe(first.citation.source_text);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(chips.first()).toBeFocused();

  const draftResponse = page.waitForResponse(isResponse('POST', '/ticket'), { timeout: 40_000 });
  await page.getByRole('button', { name: 'Generate Incident Ticket', exact: true }).click();
  const draft = await body<IncidentTicket>(await draftResponse);
  expect(draft.run_id).toBe(run.run_id);
  expect(draft.status).toBe('draft');
  const approve = page.getByRole('button', { name: 'Approve ticket', exact: true });
  await expect(approve).toBeDisabled();
  await page.getByRole('textbox', { name: 'Analyst name' }).fill('Demo Analyst');
  const approvedResponse = page.waitForResponse(isResponse('POST', '/approve'));
  await approve.click();
  const approved = await body<IncidentTicket>(await approvedResponse);
  expect(approved.ticket_id).toBe(draft.ticket_id);
  expect(approved.status).toBe('approved');
  expect(approved.approved_by).toBe('Demo Analyst');
  expect(approved.approved_at).toBeTruthy();
  await expect(page.getByText('Approved · read-only', { exact: true })).toBeVisible();
  await expect(page.getByRole('form', { name: 'Approve incident ticket' })).toHaveCount(0);
  await expect(approve).toHaveCount(0);

  const auditResponse = page.waitForResponse(isResponse('GET', '/audit'));
  await page.getByRole('tab', { name: 'Audit', exact: true }).click();
  const audit = await body<AuditRow[]>(await auditResponse);
  const stages = ['parse', 'retrieve', 'generate', 'verify', 'ticket', 'approve'];
  expect(audit.map((row) => row.stage).sort()).toEqual([...stages].sort());
  expect(audit.every((row) => row.run_id === run.run_id)).toBe(true);
  const table = page.getByRole('table', { name: `Audit records for ${run.run_id}`, exact: true });
  await expect(table.locator('tbody > tr')).toHaveCount(stages.length);
  for (const stage of stages) await expect(table.getByRole('rowheader', { name: stage, exact: true })).toHaveCount(1);
});

test('no-match: escalation banner and no containment steps', async ({ page }) => {
  const run = await runSample(page, 'No matching playbook');
  expect(run.checklist.status).toBe('no_matching_sop');
  expect(run.checklist.steps).toHaveLength(0);
  const checklist = page.getByRole('region', { name: 'Containment checklist', exact: true });
  await expect(checklist.getByRole('status')).toContainText('Escalate: no matching SOP');
  await expect(checklist.getByRole('status')).toContainText(run.checklist.escalation_note);
  await expect(checklist.getByRole('list', { name: 'Containment steps' })).toHaveCount(0);
  await expect(checklist.getByRole('button', { name: /^View source for / })).toHaveCount(0);
});
