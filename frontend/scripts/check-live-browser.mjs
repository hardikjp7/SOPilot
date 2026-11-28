import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const requireTool = createRequire(resolve(process.env.SOPILOT_AUDIT_TOOLS ?? '.npm-cache/_npx/0f94ee7615faf582/node_modules', 'package.json'));
const { default: puppeteer } = await import(pathToFileURL(requireTool.resolve('puppeteer-core')).href);
const output = resolve('test-results/live-integration');
await mkdir(output, { recursive: true });
const report = { started_at: new Date().toISOString(), complete: false, samples: [], contract_warnings: [], console_errors: [], failed_requests: [], preflights: [], responses: [], backend_deviations: [], frontend_failures: [] };
if (process.env.SOPILOT_RESUME === '1') {
  const previous = JSON.parse(await readFile(resolve(output, 'report.json'), 'utf8'));
  await writeFile(resolve(output, `attempt-${previous.started_at.replaceAll(':', '-')}.json`), JSON.stringify(previous, null, 2));
  assert.equal(previous.backend_deviations.length, 0, 'A backend deviation must be resolved by its owner before resuming.');
  report.samples = previous.samples.filter((sample) => sample.complete);
  for (const key of ['contract_warnings', 'console_errors', 'failed_requests', 'preflights', 'responses']) report[key] = previous[key] ?? [];
  report.resumed_from = previous.started_at;
}
let context = 'startup';
let phase = 'startup';
let duplicateApproval = false;
let stopped = false;
const pending = new Set();
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true,
  userDataDir: resolve('.tools/live-integration-profile'), args: ['--no-sandbox', '--disable-dev-shm-usage'], defaultViewport: { width: 1440, height: 1000 } });
const page = await browser.newPage();
const frontUrl = process.env.SOPILOT_URL ?? 'http://localhost:5173';
const python = resolve('../.venv/bin/python');
const writeReport = () => writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2));

async function recordDeviation(endpoint, issues, sample = context) {
  stopped = true;
  for (const issue of issues) report.backend_deviations.push({ endpoint, sample, ...issue });
  const file = resolve('../docs/INTEGRATION-ISSUES.md');
  let existing = '';
  try { existing = await readFile(file, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const escape = (value) => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
  const rows = issues.map(({ path, expected, got }) => `| ${escape(endpoint)} | ${escape(path)} | ${escape(expected)} | ${escape(got)} | ${escape(sample)} |`).join('\n');
  const heading = existing ? '\n' : '# Integration issues\n';
  await writeFile(file, existing + heading + `\n## ${new Date().toISOString()} — Live backend deviation\n\n| Endpoint | Field path | Expected | Got | Sample |\n| --- | --- | --- | --- | --- |\n${rows}\n\nStopped integration at the first backend deviation. No backend or type contract was changed.\n`);
  await writeReport();
}

page.on('console', (message) => {
  const entry = { sample: context, phase, text: message.text(), url: message.location().url ?? '', expected_conflict: duplicateApproval && message.text().includes('409') && (message.location().url ?? '').endsWith('/api/approve') };
  if (message.type() === 'warning' && message.text().includes('[SOPilot contract')) report.contract_warnings.push(entry);
  if (message.type() === 'error') report.console_errors.push(entry);
});
page.on('pageerror', (error) => report.console_errors.push({ sample: context, phase, text: error.message, kind: 'pageerror' }));
page.on('requestfailed', (request) => report.failed_requests.push({ sample: context, phase, url: request.url(), reason: request.failure()?.errorText, kind: 'transport' }));
page.on('response', (response) => {
  const url = new URL(response.url());
  if (response.request().method() === 'OPTIONS') {
    report.preflights.push({ sample: context, endpoint: url.pathname, status: response.status() });
    return;
  }
  if (url.origin !== 'http://localhost:8000' || !url.pathname.startsWith('/api/')) {
    if (response.status() >= 400) report.failed_requests.push({ sample: context, phase, url: response.url(), status: response.status(), kind: 'http' });
    return;
  }
  const sample = context;
  const stage = phase;
  const endpoint = url.pathname.slice(4);
  const status = response.status();
  const expectedConflict = duplicateApproval && endpoint === '/approve' && status === 409;
  const task = (async () => {
    const entry = { sample, phase: stage, endpoint, status, expected_conflict: expectedConflict };
    report.responses.push(entry);
    if (status >= 400) report.failed_requests.push({ ...entry, kind: 'http' });
    if (endpoint.endsWith('/export.md') && status < 400) {
      if (!(response.headers()['content-type'] ?? '').startsWith('text/markdown')) await recordDeviation(endpoint, [{ path: '$.content_type', expected: 'text/markdown', got: response.headers()['content-type'] ?? 'missing' }], sample);
      return;
    }
    let body;
    try { body = await response.json(); } catch { await recordDeviation(endpoint, [{ path: '$', expected: 'valid JSON response', got: 'non-JSON response' }], sample); return; }
    const issues = JSON.parse(execFileSync(python, ['scripts/check-response.py'], { cwd: process.cwd(), input: JSON.stringify({ endpoint, status, body }), encoding: 'utf8' }));
    if (status >= 400) entry.error_code = body?.error?.code;
    if (issues.length) await recordDeviation(endpoint, issues, sample);
    if (endpoint === '/run' && status < 400) entry.run_id = body.run_id;
    if ((endpoint === '/ticket' || endpoint === '/approve') && status < 400) entry.ticket_id = body.ticket_id;
  })().catch((error) => report.frontend_failures.push({ sample, phase: stage, reason: `Response inspection failed: ${error.message}` }));
  pending.add(task);
  task.finally(() => pending.delete(task));
});

async function flush() {
  await Promise.all([...pending]);
  await writeReport();
  if (stopped) throw new Error('Stopped at a canonical backend deviation; see docs/INTEGRATION-ISSUES.md.');
}
async function button(text) {
  const buttons = await page.$$('button');
  for (const candidate of buttons) if (await candidate.evaluate((node, value) => node.textContent.trim() === value, text)) return candidate;
  throw new Error(`Button unavailable: ${text}`);
}
async function click(text) { await (await button(text)).click(); }
async function ready(selector, timeout = 50000) { await page.waitForSelector(selector, { timeout }); await flush(); }
async function screenshot(name) { await page.screenshot({ path: resolve(output, `${name}.png`), fullPage: false }); }
function postResponse(endpoint) {
  return page.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname === `/api${endpoint}`, { timeout: 50000 });
}

try {
  await page.goto(frontUrl, { waitUntil: 'networkidle0' });
  await ready('option[value="ALR-PHI"]');
  await page.waitForFunction(() => document.querySelector('[aria-label="Backend health"]')?.textContent.includes('Live'));
  await flush();
  report.health_badge = await page.$eval('[aria-label="Backend health"]', (node) => node.textContent);
  const initial = await page.evaluate(async () => {
    const { apiClient } = await import('/src/api/index.ts');
    return { samples: (await apiClient.samples()).map(({ id, name }) => ({ id, name })) };
  });
  await flush();
  assert.ok(report.responses.some((entry) => entry.endpoint === '/samples' && entry.status === 200), 'Samples must come from the real backend over HTTP.');
  assert.equal(initial.samples.length, 6);
  await browser.defaultBrowserContext().overridePermissions(frontUrl, ['clipboard-read', 'clipboard-write']);
  const cdp = await page.createCDPSession();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: resolve(output, 'downloads') });
  await screenshot('01-live-intake');

  for (const [index, sample] of initial.samples.entries()) {
    if (report.samples.some((outcome) => outcome.sample === sample.id && outcome.complete)) continue;
    context = sample.id;
    phase = 'run';
    const outcome = { sample: sample.id, complete: false };
    report.samples.push(outcome);
    console.log(`Running ${sample.id} (${index + 1}/6)`);
    await page.click('#investigation-workspace-tab');
    await page.select('select', sample.id);
    const runResponse = postResponse('/run');
    await click('Run analysis');
    await runResponse;
    await flush();
    const run = [...report.responses].reverse().find((entry) => entry.sample === sample.id && entry.endpoint === '/run' && entry.status === 200);
    await page.waitForFunction((id) => document.querySelector('[aria-label="Analysis ready for review"]')?.textContent.includes(id) || document.querySelector('[aria-label="Analysis needs attention"]'), { timeout: 50000 }, run?.run_id ?? 'missing response');
    await flush();
    if (await page.$('[aria-label="Analysis needs attention"]')) throw new Error(`Analysis failed for ${sample.id}; inspect recorded diagnostics.`);
    assert.ok(run?.run_id);
    outcome.run_id = run.run_id;
    const citation = await page.$('button[aria-label^="View source for"]');
    if (citation) {
      phase = 'citation';
      await citation.click();
      await ready('dialog[open]');
      await page.click('button[aria-label="Close citation panel"]');
    }
    phase = 'ticket';
    const ticketResponse = postResponse('/ticket');
    await click('Generate Incident Ticket');
    await ticketResponse;
    await ready('[aria-label="Incident ticket ready for review"], [aria-label="Ticket generation needs attention"]');
    if (await page.$('[aria-label="Ticket generation needs attention"]')) throw new Error(`Ticket generation failed for ${sample.id}; inspect recorded diagnostics.`);
    const ticket = [...report.responses].reverse().find((entry) => entry.sample === sample.id && entry.endpoint === '/ticket' && entry.status === 200);
    assert.ok(ticket?.ticket_id);
    outcome.ticket_id = ticket.ticket_id;
    await page.type('input[autocomplete="name"]', 'Integration Analyst');
    phase = 'approval';
    if (index === initial.samples.length - 1) {
      const first = await page.evaluate(async (id) => {
        const { apiClient } = await import('/src/api/index.ts');
        const approved = await apiClient.approve(id, 'Integration Analyst');
        return { status: approved.status, by: approved.approved_by };
      }, ticket.ticket_id);
      await flush();
      assert.deepEqual(first, { status: 'approved', by: 'Integration Analyst' });
      duplicateApproval = true;
      await click('Approve ticket');
      await page.waitForFunction(() => document.body.textContent.includes('Ticket already approved'));
      await flush();
      outcome.duplicate_approval_message = 'Ticket already approved';
      duplicateApproval = false;
    } else {
      await click('Approve ticket');
      await page.waitForFunction(() => document.body.textContent.includes('Approved · read-only'));
      await flush();
    }
    assert.equal(await page.$('input[autocomplete="name"]'), null);
    phase = 'export';
    await click('Copy Markdown');
    await page.waitForFunction(() => document.body.textContent.includes('Markdown copied to clipboard.') || document.body.textContent.includes('Clipboard unavailable. Select the Markdown below'));
    const manual = await page.$('textarea[readonly]');
    outcome.copy_mode = manual ? 'manual fallback' : 'clipboard';
    if (manual) {
      const markdown = await manual.evaluate((node) => node.value);
      assert.ok(markdown.includes(ticket.ticket_id) && markdown.includes('Integration Analyst'));
      await click('Select Markdown');
      assert.equal(await manual.evaluate((node) => node.selectionEnd), markdown.length);
    }
    await click('Download Markdown');
    await page.waitForFunction(() => document.body.textContent.includes('Markdown download started.'));
    await flush();
    phase = 'audit';
    await page.click('#investigation-audit-tab');
    await ready('table');
    assert.equal(await page.$$eval('tbody > tr', (rows) => rows.length), 6);
    await page.click('button[aria-label^="Show details for verify audit row"]');
    await ready('pre[aria-label^="Formatted details for verify audit row"]');
    if (index === 0 || index === initial.samples.length - 1) await screenshot(`${sample.id}-audit`);
    outcome.complete = true;
    await flush();
    console.log(`Completed ${sample.id}: ${run.run_id}, ${ticket.ticket_id}`);
  }
  assert.equal(report.contract_warnings.length, 0, 'Frontend contract checker warnings were recorded.');
  assert.equal(report.console_errors.filter((entry) => entry.kind === 'pageerror').length, 0, 'Browser JavaScript exceptions were recorded.');
  assert.equal(report.console_errors.filter((entry) => !entry.expected_conflict).length, 0, 'Unexpected browser console errors were recorded.');
  assert.equal(report.frontend_failures.length, 0);
  report.complete = report.samples.length === 6 && report.samples.every((sample) => sample.complete);
} catch (error) {
  report.frontend_failures.push({ sample: context, phase, reason: error.message });
  console.log(`Stopped ${context}/${phase}: ${error.message}`);
  await screenshot('stopped');
} finally {
  await Promise.all([...pending]);
  phase = 'cleanup';
  await browser.close();
  await writeReport();
}
console.log(JSON.stringify({ complete: report.complete, samples: report.samples, contract_warnings: report.contract_warnings.length,
  console_errors: report.console_errors.length, failed_requests: report.failed_requests.length, backend_deviations: report.backend_deviations, frontend_failures: report.frontend_failures }, null, 2));
if (!report.complete) process.exitCode = 1;
