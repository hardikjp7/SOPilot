// Final captures use normal UI actions, real responses in LIVE=1, and no DOM state patches.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { createServer, loadEnv } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(root, '../docs/screens');
const live = process.env.LIVE === '1';
const env = loadEnv('screenshots', root, 'VITE_');
const apiBase = (process.env.VITE_API_BASE_URL || env.VITE_API_BASE_URL)?.replace(/\/+$/, '');
const frontendURL = process.env.E2E_BASE_URL || 'http://localhost:5173';
const mockURL = 'http://localhost:5174';
const viewport = { width: 1440, height: 900 };
const captures = [];
const observed = [];
const issues = [];
const servers = [];
let browser;
let context;
let stage = 'configuration';

function publicURL(value) {
  const url = new URL(value);
  assert.ok(['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash,
    'Capture URLs must not contain credentials, query parameters, or fragments');
  return url;
}

async function serve(mock) {
  const url = publicURL(mock ? mockURL : frontendURL);
  if (!mock) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (response.ok) return url.href;
    } catch { /* Start the local frontend if it is not already running. */ }
    assert.ok(!process.env.E2E_BASE_URL, 'The explicitly configured frontend must already be running');
  }
  const server = await createServer({
    root,
    configFile: resolve(root, 'vite.config.ts'),
    mode: 'screenshots',
    logLevel: 'error',
    define: {
      'import.meta.env.VITE_USE_MOCK': JSON.stringify(mock ? 'true' : 'false'),
      'import.meta.env.VITE_API_BASE_URL': JSON.stringify(apiBase || ''),
    },
    server: { host: url.hostname, port: Number(url.port), strictPort: true },
  });
  await server.listen();
  servers.push(server);
  return url.href;
}

const responseFor = (method, endpoint) => (response) => response.request().method() === method
  && response.url().split('?')[0] === `${apiBase}${endpoint}`;

async function jsonResponse(response) {
  assert.equal(response.status(), 200, 'Capture requires a successful API response');
  return response.json();
}

async function openPage(mock) {
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  page.on('pageerror', () => issues.push('Uncaught browser error'));
  page.on('console', (message) => {
    if (message.type() === 'error') issues.push('Browser console error');
    if (message.type() === 'warning' && message.text().includes('[SOPilot contract')) issues.push('Contract warning');
  });
  page.on('requestfailed', () => issues.push('Failed browser request'));
  page.on('response', (response) => { if (response.status() >= 400) issues.push(`HTTP ${response.status()}`); });
  await page.addInitScript(() => {
    localStorage.setItem('sopilot.theme', 'dark');
    localStorage.setItem('sopilot.largeText', 'false');
  });
  const health = mock ? null : page.waitForResponse(responseFor('GET', '/health'));
  await page.goto(await serve(mock));
  await expect(page.getByRole('status', { name: 'Backend health' })).toContainText(mock ? 'Mock' : 'Live');
  await expect(page.getByLabel('Sample alert', { exact: true })).toBeEnabled();
  if (health) {
    const result = await jsonResponse(await health);
    assert.equal(result.mock, false);
    assert.ok(result.index_chunks > 0);
  }
  return page;
}

async function samples(page) {
  return page.getByLabel('Sample alert', { exact: true }).locator('option').evaluateAll((options) =>
    options.filter((option) => option.value).map((option) => ({ id: option.value, name: option.textContent })));
}

async function run(page, sample, mock = false, pastedAlert) {
  stage = `${mock ? 'mock' : 'live'} run ${sample.id}`;
  await page.getByRole('tab', { name: 'Workspace', exact: true }).click();
  if (pastedAlert) await page.getByRole('textbox', { name: 'Alert JSON', exact: true }).fill(JSON.stringify(pastedAlert, null, 2));
  else await page.getByLabel('Sample alert', { exact: true }).selectOption(sample.id);
  const response = mock ? null : page.waitForResponse(responseFor('POST', '/run'), { timeout: 40_000 });
  await page.getByRole('button', { name: 'Run analysis', exact: true }).click();
  const ready = page.getByRole('group', { name: 'Analysis ready for review', exact: true });
  await expect(ready).toBeVisible({ timeout: 40_000 });
  // Mock mode reads its normal ApiClient result, without replacing UI responses.
  const result = response ? await jsonResponse(await response) : await page.evaluate(async () => {
    const { apiClient } = await import('/src/api/index.ts');
    return apiClient.run(JSON.parse(document.querySelector('textarea').value));
  });
  await expect(ready).toContainText(result.run_id);
  const record = { sample: sample.id, name: sample.name, mode: mock ? 'Mock' : 'Live', status: result.checklist.status, run_id: result.run_id };
  observed.push(record);
  console.log(`${record.mode}: ${sample.id} -> ${record.status}`);
  return { result, record };
}

async function frame(page, locator) {
  await expect(locator).toBeVisible();
  await locator.evaluate((element) => window.scrollTo({ top: window.scrollY + element.getBoundingClientRect().top - 32, behavior: 'instant' }));
}

async function capture(page, name, record) {
  stage = `capture ${name}`;
  assert.deepEqual(page.viewportSize(), viewport);
  await expect(page.locator('html')).toHaveClass(/\bdark\b/);
  await page.evaluate(() => document.fonts.ready);
  const visible = await page.locator('body').innerText();
  assert.ok(!/(?:\bsk-[A-Za-z0-9_-]{16,}|\bBearer\s+[A-Za-z0-9_.-]{16,}|-----BEGIN (?:RSA |EC )?PRIVATE KEY-----)/.test(visible), 'Possible secret in page text');
  assert.equal(issues.length, 0, 'Browser errors or contract warnings prevent capture');
  const path = resolve(output, `${name}.png`);
  await page.screenshot({ path, fullPage: false, animations: 'disabled' });
  const png = await readFile(path);
  assert.equal(png.readUInt32BE(16), viewport.width);
  assert.equal(png.readUInt32BE(20), viewport.height);
  assert.ok(png.length > 10_000, 'Screenshot must contain rendered content');
  captures.push({ file: `${name}.png`, ...record, bytes: png.length });
  console.log(`Saved ${name}.png (${record.mode})`);
}

async function main() {
  if (live) { assert.ok(apiBase, 'Set VITE_API_BASE_URL for LIVE=1'); publicURL(apiBase); }
  await mkdir(output, { recursive: true });
  browser = await chromium.launch();
  context = await browser.newContext({ viewport, deviceScaleFactor: 1, colorScheme: 'dark', reducedMotion: 'reduce' });
  const page = await openPage(!live);
  const available = await samples(page);
  const ransomware = available.find((sample) => /ransomware/i.test(sample.name));
  assert.ok(ransomware, 'Ransomware sample must be available');
  await page.getByLabel('Sample alert', { exact: true }).selectOption(ransomware.id);
  await page.evaluate(() => window.scrollTo(0, 0));
  await capture(page, '01-intake', { sample: ransomware.id, name: ransomware.name, mode: live ? 'Live' : 'Mock', status: null });
  const grounded = await run(page, ransomware, !live);
  assert.equal(grounded.result.checklist.status, 'grounded', 'Ransomware must really be grounded');
  assert.ok(grounded.result.checklist.steps.length >= 3);
  await frame(page, page.getByRole('region', { name: 'Parsed alert', exact: true }));
  await capture(page, '02-parsed-alert', grounded.record);
  const checklist = page.getByRole('region', { name: 'Containment checklist', exact: true });
  await expect(checklist.getByText('Grounded', { exact: true })).toBeVisible();
  await frame(page, checklist);
  await capture(page, '03-checklist-grounded', grounded.record);
  await checklist.getByRole('button', { name: /^View source for / }).first().click();
  await expect(page.getByRole('dialog', { name: 'Playbook citation' })).toBeVisible();
  assert.equal(await page.getByRole('region', { name: 'Exact playbook source' }).textContent(), grounded.result.checklist.steps[0].citation.source_text);
  await capture(page, '04-citation-panel', grounded.record);
  await page.keyboard.press('Escape');

  const draftResponse = live ? page.waitForResponse(responseFor('POST', '/ticket'), { timeout: 40_000 }) : null;
  await page.getByRole('button', { name: 'Generate Incident Ticket', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Incident ticket ready for review' })).toBeVisible({ timeout: 40_000 });
  if (draftResponse) assert.equal((await jsonResponse(await draftResponse)).status, 'draft');
  await page.getByRole('textbox', { name: 'Analyst name' }).fill('Demo Analyst');
  await frame(page, page.getByRole('form', { name: 'Approve incident ticket' }));
  await capture(page, '07-approval', grounded.record);
  const approval = live ? page.waitForResponse(responseFor('POST', '/approve')) : null;
  await page.getByRole('button', { name: 'Approve ticket', exact: true }).click();
  await expect(page.getByText('Approved · read-only', { exact: true })).toBeVisible();
  if (approval) assert.equal((await jsonResponse(await approval)).status, 'approved');
  await frame(page, page.getByText('Approved · read-only', { exact: true }));
  await capture(page, '08-ticket-approved', grounded.record);
  const auditResponse = live ? page.waitForResponse(responseFor('GET', '/audit')) : null;
  await page.getByRole('tab', { name: 'Audit', exact: true }).click();
  const table = page.getByRole('table');
  await expect(table.locator('tbody > tr')).toHaveCount(6);
  if (auditResponse) {
    const rows = await jsonResponse(await auditResponse);
    assert.deepEqual(rows.map((row) => row.stage).sort(), ['approve', 'generate', 'parse', 'retrieve', 'ticket', 'verify']);
    assert.ok(rows.every((row) => row.run_id === grounded.result.run_id));
  }
  await frame(page, page.getByRole('heading', { name: 'Audit trail' }));
  await capture(page, '09-audit', grounded.record);

  // The supplied frontend USB input is synthetic data, not a substituted response.
  // Backend /samples currently has no USB alert, so paste this input into the real intake.
  const usb = await page.evaluate(async () => {
    const { samples } = await import('/src/mocks/fixtures.ts');
    return samples.find((sample) => /USB/i.test(sample.name));
  });
  assert.ok(usb, 'Supplied USB input must exist');
  const noMatch = await run(page, usb, !live, usb.alert);
  assert.equal(noMatch.result.checklist.status, 'no_matching_sop');
  await expect(checklist.getByRole('status')).toContainText('Escalate: no matching SOP');
  await expect(checklist.getByRole('list', { name: 'Containment steps' })).toHaveCount(0);
  await frame(page, checklist);
  await capture(page, '06-no-match', noMatch.record);

  let lowConfidence = false;
  // Try every remaining real sample before allowing the single mock exception.
  for (const sample of available.filter((sample) => sample.id !== ransomware.id)) {
    const outcome = await run(page, sample, !live);
    if (outcome.result.checklist.status === 'low_confidence' && !lowConfidence) {
      await expect(checklist.getByRole('status')).toContainText('Low confidence: manual review required');
      await frame(page, checklist);
      await capture(page, '05-low-confidence', outcome.record);
      lowConfidence = true;
    }
  }
  if (!lowConfidence) {
    assert.ok(live, 'Mock samples must supply a low-confidence case');
    const mockPage = await openPage(true);
    const phishing = (await samples(mockPage)).find((sample) => /phish/i.test(sample.name));
    assert.ok(phishing);
    const outcome = await run(mockPage, phishing, true);
    assert.equal(outcome.result.checklist.status, 'low_confidence');
    const mockChecklist = mockPage.getByRole('region', { name: 'Containment checklist', exact: true });
    await expect(mockChecklist.getByRole('status')).toContainText('Low confidence: manual review required');
    await frame(mockPage, mockChecklist);
    await capture(mockPage, '05-low-confidence', { ...outcome.record, exception: 'No real sample produced low_confidence in this capture run.' });
  }
  captures.sort((a, b) => a.file.localeCompare(b.file));
  assert.equal(captures.length, 9);
  assert.equal(captures.filter((shot) => shot.mode === 'Mock').length, live ? (lowConfidence ? 0 : 1) : 9);
  const manifest = { captured_at: new Date().toISOString(), live_requested: live, viewport, theme: 'dark', captures, observed_samples: observed, browser_issues: issues };
  await writeFile(resolve(output, 'capture.json'), JSON.stringify(manifest, null, 2) + '\n');
  const lines = ['# Final screenshots', '', `Captured ${manifest.captured_at}. All PNGs are 1440 × 900, dark theme, synthetic alerts only.`, '',
    live ? 'The demo was reset with `scripts/reset_demo.py` before this live capture; its vector index was kept. Ransomware audit has one row for each of the six stages.' : 'This is a mock capture; it does not create live backend records.', '',
    '| File | Sample | Mode |', '|---|---|---|',
    ...captures.map((shot) => `| [${shot.file}](${shot.file}) | ${shot.name} (${shot.sample}) | ${shot.mode} |`), '',
    live && !lowConfidence ? '**Mock exception:** only `05-low-confidence.png` uses the frontend phishing fixture. None of the six backend samples or the USB input produced low confidence in this run. The Mock badge and actual low-confidence fixture are used; no live response was rewritten.' : 'No additional mock exception was needed.', '',
    live ? 'The backend sample list has no USB alert. `06-no-match.png` uses the supplied USB input (`no-match-usb` / `DLP-3320`) pasted into intake and submitted to the real API. All other live shots use the backend ransomware sample. Full observed sample statuses are recorded in `capture.json`.' : 'All screenshots use the normal frontend mock client and its supplied samples.', '',
    'Reproduce: reset the demo with the backend stopped, restart it, then run `LIVE=1 npm run screenshots` from `frontend/`. API base URL comes from `VITE_API_BASE_URL` in the environment or frontend configuration. `LIVE=1 node scripts/check-demo.mjs` delegates to the same Playwright capture. Without LIVE=1, screenshots use the normal mock app.', ''];
  await writeFile(resolve(output, 'README.md'), lines.join('\n'));
  console.log(`PASS: nine dark ${viewport.width}x${viewport.height} screenshots; ${captures.filter((shot) => shot.mode === 'Mock').length} mock shot(s).`);
}

try { await main(); }
catch (error) {
  // Do not print upstream bodies, console payloads, or configuration values.
  console.error(`FAIL: screenshot capture at ${stage} (${error.name}).`);
  process.exitCode = 1;
} finally {
  await browser?.close();
  for (const server of servers) await server.close();
}
