import { expect, type Page, type Route } from '@playwright/test';

/** Verified against OpenAPI `/api/v1/auth/*` — never mock 401 on these during session tests. */
const AUTH_API_PREFIX = '/api/v1/auth/';

export function isExcludedFrom401Mock(url: string): boolean {
  try {
    const path = new URL(url).pathname;
    return path.startsWith(AUTH_API_PREFIX);
  } catch {
    return false;
  }
}

const UNAUTH_BODY = JSON.stringify({
  status: 401,
  code: 'unauthenticated',
  title: 'Authentication required',
  request_id: 'e2e-unauth',
});

/** After the caller establishes a real session, fail selected API reads with 401. */
export async function routeApi401ExceptAuth(page: Page) {
  await page.route('**/api/v1/**', async (route: Route) => {
    const url = route.request().url();
    if (isExcludedFrom401Mock(url)) {
      await route.continue();
      return;
    }
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: UNAUTH_BODY,
      });
      return;
    }
    await route.continue();
  });
}

/** Hold the first POST to create an issue until `release()` is called. */
export async function holdFirstCreateIssuePost(page: Page): Promise<{
  release: () => void;
  getPostCount: () => number;
}> {
  let postCount = 0;
  let releaseGate: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    releaseGate = resolve;
  });

  await page.route('**/api/v1/orgs/*/projects/*/issues', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    postCount += 1;
    await gate;
    await route.continue();
  });

  return {
    release: () => releaseGate?.(),
    getPostCount: () => postCount,
  };
}

export async function expectSessionExpiredDialogOnce(page: Page) {
  const dialog = page.getByRole('dialog', { name: 'Session expired' });
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await expect(dialog).toHaveCount(1);
  return dialog;
}

/** Reload while GET routes return 401 so React Query dispatches session expiry (parallel queries). */
export async function triggerSessionExpiryViaReload(page: Page) {
  await page.reload({ waitUntil: 'domcontentloaded' });
}
