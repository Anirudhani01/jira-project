import { defineConfig, devices } from '@playwright/test';

/**
 * Mocked API specs (a4a fixtures) use a dedicated Vite port so tests never attach to an
 * unrelated app on :5173 from another worktree or `make dev`.
 *
 * - Default: Playwright starts this worktree's Vite on PLAYWRIGHT_MOCK_PORT (5193).
 * - Full stack (`make dev` + journeys): set E2E_BASE_URL to the same address as APP_BASE_URL
 *   (http://localhost:5173 with the default env files). The API rejects writes from any other
 *   origin, so 127.0.0.1 and localhost are not interchangeable. `make e2e-ux-states` sets it.
 */
const PLAYWRIGHT_MOCK_PORT = process.env.PLAYWRIGHT_MOCK_PORT ?? '5193';
const mockBaseURL = `http://127.0.0.1:${PLAYWRIGHT_MOCK_PORT}`;

const rawExternalBaseURL = process.env.E2E_BASE_URL?.trim() ?? '';
const externalBaseURL = rawExternalBaseURL ? rawExternalBaseURL.replace(/\/$/, '') : undefined;
if (externalBaseURL && !/^https?:\/\//.test(externalBaseURL)) {
  throw new Error(`E2E_BASE_URL must be an absolute http(s) URL, got: ${externalBaseURL}`);
}

const baseURL = externalBaseURL ?? mockBaseURL;
const useManagedMockWebServer = externalBaseURL === undefined;

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  webServer: useManagedMockWebServer
    ? {
        command: `pnpm exec vite --host 127.0.0.1 --port ${PLAYWRIGHT_MOCK_PORT} --strictPort`,
        url: mockBaseURL,
        reuseExistingServer: false,
        timeout: 120_000,
      }
    : undefined,
  projects: [
    {
      name: 'chromium',
      testIgnore: '**/suites/**',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mvp-journeys',
      testMatch: '**/suites/**/*.suite.spec.ts',
      fullyParallel: false,
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
