import { defineConfig, devices } from '@playwright/test';

const CI = Boolean(process.env.CI);

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
    baseURL: 'http://localhost:5173',
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
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !CI,
    timeout: 120_000,
  },
});
