import { defineConfig, devices } from '@playwright/test';

/** End-to-end journeys run against a live stack (`make e2e` starts it): the SPA on
 * localhost:5173 (same origin as APP_BASE_URL), the API behind its proxy, the outbox worker
 * and Mailpit (http://localhost:8025) for verification emails. */
export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
