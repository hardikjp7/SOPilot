// Standalone QA tooling; no application dependencies are added.
// Set SOPILOT_AUDIT_TOOLS to the node_modules directory containing Lighthouse.
// LIVE=1 delegates final capture to Playwright; the accessibility audit stays unchanged.
if (process.env.LIVE === '1') {
  await import('./capture-screenshots.mjs');
  process.exit(process.exitCode ?? 0);
}
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const toolsDirectory = process.env.SOPILOT_AUDIT_TOOLS;
if (!toolsDirectory) throw new Error('Set SOPILOT_AUDIT_TOOLS to the standalone audit tools directory.');
const requireTool = createRequire(resolve(toolsDirectory, 'package.json'));
const { default: puppeteer } = await import(pathToFileURL(requireTool.resolve('puppeteer-core')).href);
const { startFlow } = await import(pathToFileURL(requireTool.resolve('lighthouse')).href);
const output = resolve('test-results');
await mkdir(output, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: process.env.SOPILOT_CHROME ?? '/usr/bin/google-chrome',
  headless: true,
  userDataDir: resolve('.tools/demo-audit-profile'),
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--no-first-run'],
  defaultViewport: { width: 1440, height: 1000 },
});
const checks = [];
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(process.env.SOPILOT_URL ?? 'http://localhost:5173', { waitUntil: 'networkidle0' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('option[value="ransomware-fin-ws"]');
  await page.waitForFunction(() => !document.querySelector('[aria-label="Backend health"]').textContent.includes('Connecting'));
  assert.equal(await page.$eval('[aria-label="Backend health"]', (node) => node.textContent.includes('Mock')), true, 'Use VITE_USE_MOCK=true for this demo check.');
  const flow = await startFlow(page, { name: 'SOPilot keyboard demo and theme accessibility', flags: {
    onlyCategories: ['accessibility'], formFactor: 'desktop', screenEmulation: { disabled: true }, disableStorageReset: true,
  } });

  async function snapshot(name) {
    console.log(`Auditing: ${name}`);
    await flow.snapshot({ name });
  }
  async function tabTo(selector, text) {
    for (let count = 0; count < 100; count++) {
      const found = await page.evaluate((css, label) => {
        const active = document.activeElement;
        return active?.matches(css) && (!label || active.textContent?.trim() === label);
      }, selector, text);
      if (found) return;
      await page.keyboard.press('Tab');
    }
    throw new Error(`Could not reach ${text ?? selector} with Tab.`);
  }
  async function activate(text) {
    await tabTo('button', text);
    await page.keyboard.press('Space');
  }
  async function focused(selector) {
    await page.waitForFunction((css) => document.activeElement?.matches(css), {}, selector);
  }

  await snapshot('Intake · dark');
  await page.screenshot({ path: resolve(output, 'demo-intake-dark.png'), fullPage: true });
  await activate('Light theme');
  await snapshot('Intake · light');
  await page.screenshot({ path: resolve(output, 'demo-intake-light.png'), fullPage: true });
  await activate('Light theme');

  // This walkthrough uses keyboard events only: no click, focus, fill or DOM edits.
  await tabTo('select');
  await page.keyboard.press('ArrowDown');
  await focused('textarea');
  assert.match(await page.$eval('textarea', (node) => node.value), /FIN-WS-014/);
  checks.push('Keyboard sample selection focused the JSON editor.');
  await activate('Run analysis');
  await focused('[aria-label="Analysis in progress"]');
  await page.waitForSelector('[aria-label="Analysis ready for review"]');
  await focused('[aria-label="Analysis ready for review"]');
  checks.push('Run moved focus through loading to the returned checklist.');
  await snapshot('Grounded checklist · dark');
  await page.evaluate(() => scrollTo(0, 250));
  await page.screenshot({ path: resolve(output, 'demo-workspace.png') });
  await tabTo('button[aria-label="View source for PB-RAN-01"]');
  await page.keyboard.press('Enter');
  await page.waitForSelector('dialog[open]');
  await focused('button[aria-label="Close citation panel"]');
  await snapshot('Citation panel · dark');
  await page.keyboard.press('Tab');
  await focused('[aria-label="Exact playbook source"]');
  await page.keyboard.press('Tab');
  await focused('button[aria-label="Close citation panel"]');
  await page.keyboard.press('Escape');
  await focused('button[aria-label="View source for PB-RAN-01"]');
  checks.push('Citation Enter, Tab trap, Escape and focus return passed.');
  await activate('Light theme');
  await tabTo('button[aria-label="View source for PB-RAN-01"]');
  await page.keyboard.press('Enter');
  await page.waitForSelector('dialog[open]');
  await snapshot('Citation panel · light');
  await page.keyboard.press('Escape');
  await activate('Light theme');

  await activate('Generate Incident Ticket');
  await focused('[aria-label="Ticket generation in progress"]');
  await page.waitForSelector('[aria-label="Incident ticket ready for review"]');
  await focused('[aria-label="Incident ticket ready for review"]');
  await snapshot('Draft ticket · dark');
  await tabTo('input[autocomplete="name"]');
  await page.keyboard.type('Demo Analyst');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.textContent.trim()), 'Approve ticket');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.body.textContent.includes('Approved · read-only'));
  await focused('[role="status"].focus-target');
  assert.equal(await page.$('input[autocomplete="name"]'), null);
  checks.push('Keyboard-only intake → citation review → draft → approved ticket passed; focus moved to the read-only approval.');
  await snapshot('Approved ticket · dark');
  await activate('Light theme');
  await snapshot('Approved ticket · light');
  await activate('Larger text');
  assert.equal(await page.$eval('html', (node) => getComputedStyle(node).fontSize), '20px');
  await snapshot('Approved ticket · light · larger text');

  for (const width of [390, 768, 899, 900, 1440]) {
    await page.setViewport({ width, height: 1000 });
    const layout = await page.evaluate(() => {
      const workspace = document.querySelector('#investigation-workspace-panel > .grid');
      return { pageWidth: document.documentElement.scrollWidth, viewport: innerWidth, columns: getComputedStyle(workspace).gridTemplateColumns.split(' ').length };
    });
    assert.ok(layout.pageWidth <= layout.viewport, `Page overflows at ${width}px: ${JSON.stringify(layout)}`);
    assert.equal(layout.columns, width < 900 ? 1 : 2);
    checks.push(`Larger text layout at ${width}px: ${layout.columns} column(s), no page overflow.`);
  }
  await page.setViewport({ width: 390, height: 844 });
  await snapshot('Approved ticket · light · larger text · mobile');
  await page.screenshot({ path: resolve(output, 'demo-approved-mobile.png'), fullPage: true });
  await page.setViewport({ width: 1440, height: 1000 });
  await activate('Light theme');
  await page.screenshot({ path: resolve(output, 'demo-approved-dark.png'), fullPage: true });

  await tabTo('summary');
  await page.keyboard.press('Enter');
  await page.waitForSelector('details[open]');
  await snapshot('Expanded badge and status guide · dark · larger text');
  await tabTo('input[type="checkbox"]');
  await page.keyboard.press('Space');
  // Move to a non-editable target, then prove D no longer launches a new run.
  await tabTo('[role="tab"][aria-selected="true"]');
  await page.keyboard.press('d');
  assert.equal(await page.$('[aria-label="Analysis in progress"]'), null);
  assert.ok(await page.$('[aria-label="Incident ticket ready for review"]'));
  checks.push('The D shortcut can be disabled from the keyboard.');

  await page.keyboard.press('ArrowRight');
  await page.waitForSelector('table');
  await tabTo('button[aria-label="Show details for verify audit row 4"]');
  await page.keyboard.press('Enter');
  await snapshot('Expanded audit · dark · larger text');
  await activate('Light theme');
  await snapshot('Expanded audit · light · larger text');
  await tabTo('[role="tab"][aria-selected="true"]');
  await page.keyboard.press('ArrowLeft');

  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await tabTo('select');
  await page.keyboard.press('p');
  await focused('textarea');
  assert.match(await page.$eval('textarea', (node) => node.value), /user_clicked/);
  await activate('Run analysis');
  await focused('[aria-label="Analysis in progress"]');
  const animated = await page.$$eval('*', (nodes) => nodes.filter((node) => {
    const style = getComputedStyle(node);
    return style.animationName !== 'none' && style.animationDuration !== '0s';
  }).length);
  assert.equal(animated, 0);
  checks.push('Reduced-motion preference leaves no active CSS animations during loading.');
  await page.waitForSelector('[aria-label="Analysis ready for review"]');
  await page.waitForFunction(() => document.body.textContent.includes('Low confidence: manual review required'));
  await snapshot('Low confidence · light · reduced motion');
  await activate('Light theme');
  await snapshot('Low confidence · dark · reduced motion');
  await tabTo('select');
  await page.keyboard.press('End');
  await focused('textarea');
  await activate('Run analysis');
  await page.waitForFunction(() => document.body.textContent.includes('Escalate: no matching SOP'));
  await snapshot('No matching SOP · dark');
  await activate('Light theme');
  await snapshot('No matching SOP · light');
  await page.setViewport({ width: 390, height: 844 });
  await snapshot('No matching SOP · light · larger text · mobile');
  assert.deepEqual(errors, []);
  checks.push('No browser JavaScript errors.');

  const result = await flow.createFlowResult();
  await writeFile(resolve(output, 'lighthouse-flow.json'), JSON.stringify(result, null, 2));
  await writeFile(resolve(output, 'lighthouse-flow.html'), await flow.generateReport());
  const scores = result.steps.map((step) => ({
    name: step.name,
    score: step.lhr.categories.accessibility.score * 100,
    failures: Object.values(step.lhr.audits).filter((audit) => audit.score !== null && audit.score < 1 && audit.details?.type === 'table').map((audit) => ({ id: audit.id, title: audit.title, items: audit.details.items })),
  }));
  await writeFile(resolve(output, 'demo-checks.json'), JSON.stringify({ checkedAt: new Date().toISOString(), lighthouse: result.steps[0].lhr.lighthouseVersion, scores, checks }, null, 2));
  console.log(JSON.stringify({ scores: scores.map(({ name, score, failures }) => ({ name, score, failures: failures.map((failure) => failure.id) })), checks }, null, 2));
  assert.ok(scores.every(({ score }) => score >= 90), 'A Lighthouse accessibility score is below 90. Inspect the HTML report.');
  assert.ok(scores.every(({ failures }) => failures.length === 0), 'An automated accessibility check failed. Inspect the HTML report.');
} finally {
  await browser.close();
}
