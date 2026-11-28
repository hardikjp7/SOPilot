import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';

// Load the actual TypeScript client in development mode, including its checker.
// No second HTTP implementation and no backend/source modifications are needed.
const baseUrl = process.env.SOPILOT_LIVE_API_URL;
if (!baseUrl) throw new Error('Set SOPILOT_LIVE_API_URL to the real backend base URL, including /api.');
const url = new URL(baseUrl);
if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
  throw new Error('Use an HTTP(S) API base URL without credentials, query parameters or a fragment.');
}
const report = { checked_at: new Date().toISOString(), base_url: url.href, complete: false, health: null, runs: [], mismatches: [], failures: [] };
let context = 'startup';
const originalWarn = console.warn;
console.warn = (...args) => {
  if (typeof args[0] === 'string' && args[0].startsWith('[SOPilot contract v2]')) {
    const issue = args[1];
    report.mismatches.push({ context, ...(issue && typeof issue.path === 'string' ? issue : { path: '$', expected: 'available response checker', got: 'unavailable checker' }) });
  }
  originalWarn(...args);
};
let server;
try {
  server = await createServer({ configFile: false, root: process.cwd(), mode: 'development', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false } });
  const { createApiClient } = await server.ssrLoadModule('/src/api/client.ts');
  const client = createApiClient(baseUrl);
  context = 'health';
  const health = await client.health();
  report.health = health;
  if (health.mock) throw new Error('The backend reports mock=true. Start it in live mode before G3 verification.');
  context = 'samples';
  const samples = await client.samples();
  if (samples.length !== 6) {
    report.mismatches.push({ context, path: '$', expected: '6 sample alerts (spec section 6)', got: `${samples.length} sample alerts` });
    throw new Error('The backend did not return the six required sample alerts.');
  }
  for (const sample of samples) {
    context = `run sample ${sample.id}`;
    const warningCount = report.mismatches.length;
    try {
      const run = await client.run(sample.alert);
      report.runs.push({ sample_id: sample.id, run_id: run.run_id, passed: report.mismatches.length === warningCount });
    } catch {
      report.runs.push({ sample_id: sample.id, passed: false });
      report.failures.push({ context, reason: 'Run failed; review the application error state and contract mismatches.' });
    }
  }
  report.complete = report.runs.length === 6 && report.runs.every((run) => run.passed) && report.mismatches.length === 0;
} catch (error) {
  // Real-client errors have fixed friendly messages, never raw server bodies.
  report.failures.push({ context, reason: error instanceof Error ? error.message : 'Live verification could not be completed.' });
} finally {
  console.warn = originalWarn;
  if (server) await server.close();
  await mkdir(resolve('test-results'), { recursive: true });
  await writeFile(resolve('test-results/live-contract-report.json'), JSON.stringify(report, null, 2));
}
console.log(JSON.stringify(report, null, 2));
if (!report.complete) process.exitCode = 1;
