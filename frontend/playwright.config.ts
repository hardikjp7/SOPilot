import { defineConfig, devices } from '@playwright/test';
import { loadEnv } from 'vite';

const env = loadEnv('e2e', process.cwd(), 'VITE_');
const apiBaseURL = (process.env.VITE_API_BASE_URL || env.VITE_API_BASE_URL)?.replace(/\/+$/, '');
if (!apiBaseURL) throw new Error('Set VITE_API_BASE_URL in the environment or frontend/.env.local.');
const apiURL = new URL(apiBaseURL);
if (!['http:', 'https:'].includes(apiURL.protocol) || apiURL.username || apiURL.password || apiURL.search || apiURL.hash) {
  throw new Error('VITE_API_BASE_URL must be an HTTP(S) URL without credentials, query parameters, or fragments.');
}
process.env.VITE_API_BASE_URL = apiBaseURL;
const baseURL = process.env.E2E_BASE_URL || 'http://localhost:5173';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  outputDir: 'test-results/e2e',
  reporter: [['list'], ['json', { outputFile: 'test-results/e2e-results.json' }]],
  use: {
    baseURL,
    screenshot: 'only-on-failure',
    trace: 'off',
    video: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: process.env.E2E_BASE_URL ? undefined : {
    command: 'npm run dev -- --mode e2e',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    env: { VITE_USE_MOCK: 'false', VITE_API_BASE_URL: apiBaseURL },
    timeout: 30_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
