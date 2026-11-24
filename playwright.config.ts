import { defineConfig, devices } from '@playwright/test';

const CI = Boolean(process.env.CI);
/** `npm run e2e:perf`: the perf spec on the bench build (local only; the other specs skip it). */
const PERF = Boolean(process.env.PERF);
const DEV_URL = 'http://localhost:5173';
const BENCH_URL = 'http://localhost:4174';

/**
 * Smoke tests driving the in-browser selftests. Locally they use the installed Google Chrome
 * (no browser download); in CI, Playwright's Chromium with software WebGL (SwiftShader).
 */
export default defineConfig({
  testDir: './e2e',
  // CI renders in software (SwiftShader) and stretches selftest waits ×4 (?timing=0).
  timeout: process.env.CI ? 800_000 : 200_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL: PERF ? BENCH_URL : DEV_URL,
    viewport: { width: 1280, height: 720 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chrome',
      use: {
        ...devices['Desktop Chrome'],
        ...(CI ? {} : { channel: 'chrome' }),
        launchOptions: {
          args: CI ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--enable-gpu'],
        },
      },
    },
  ],
  // Only the server the run needs: the plain e2e never builds the bench build.
  webServer: PERF
    ? { command: 'npm run bench', url: BENCH_URL, reuseExistingServer: true, timeout: 300_000 }
    : { command: 'npm run dev', url: DEV_URL, reuseExistingServer: !CI, timeout: 120_000 },
});
