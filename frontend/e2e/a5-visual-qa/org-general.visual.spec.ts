/**
 * A5.3 visual QA — deterministic API mocks, no live backend session.
 * Run: E2E_BASE_URL=http://127.0.0.1:5176 pnpm exec playwright test e2e/a5-visual-qa
 */
import { test, type Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '../../visual-qa/a5.3');

const SESSION = {
  user: {
    id: '11111111-1111-1111-1111-111111111111',
    email: 'owner@example.com',
    display_name: 'Owner User',
    email_verified: true,
  },
  csrf_token: 'csrf-visual',
  session: { id: 's1', expires_at: '2030-01-01T00:00:00Z' },
  orgs: [{ slug: 'acme', name: 'Acme', role: 'owner' }],
};

const ORG_OWNER = {
  id: '22222222-2222-2222-2222-222222222222',
  slug: 'acme',
  name: 'Acme',
  role: 'owner',
  permissions: ['org.view', 'org.manage', 'org.members.manage', 'org.audit.view'],
  created_at: '2026-10-27T00:00:00Z',
};

const ORG_MEMBER = { ...ORG_OWNER, role: 'member', permissions: ['org.view'] };

const ORG_SETTINGS = {
  timezone: 'UTC',
  locale: 'en-US',
  story_points_enabled: true,
  story_points_max: 100,
  updated_at: '2026-10-27T00:00:00Z',
};

type Handler = (method: string, apiPath: string) => { status: number; body: unknown } | null;

async function installMocks(page: Page, handler: Handler) {
  await page.route('**/api/v1/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const apiPath = url.pathname.replace(/^\/api\/v1/, '');
    const result = handler(req.method().toUpperCase(), apiPath);
    if (!result) {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ status: 404, code: 'not_found', title: 'not_found' }),
      });
      return;
    }
    await route.fulfill({
      status: result.status,
      contentType: 'application/json',
      body: JSON.stringify(result.body),
    });
  });
}

function baseHandler(org: typeof ORG_OWNER): Handler {
  return (method, apiPath) => {
    if (method === 'GET' && apiPath === '/auth/session') return { status: 200, body: SESSION };
    if (method === 'GET' && apiPath === '/orgs/acme') return { status: 200, body: org };
    if (method === 'GET' && apiPath === '/orgs/acme/settings')
      return { status: 200, body: ORG_SETTINGS };
    if (method === 'GET' && apiPath === '/orgs/acme/notifications/unread-count') {
      return { status: 200, body: { count: 0 } };
    }
    return null;
  };
}

async function screenshotRegional(
  page: Page,
  name: string,
  viewport: { width: number; height: number },
  ready: (page: Page) => Promise<void>,
) {
  await page.setViewportSize(viewport);
  await page.goto('/o/acme/admin/general');
  await page.getByRole('heading', { name: 'Regional preferences' }).scrollIntoViewIfNeeded();
  await ready(page);
  await page.locator('section[aria-labelledby="org-settings-regional"]').screenshot({
    path: path.join(OUT_DIR, `${name}-${viewport.width}x${viewport.height}.png`),
  });
}

test.describe('A5.3 regional preferences visual QA', () => {
  test('owner editable — desktop and mobile', async ({ page }) => {
    await installMocks(page, baseHandler(ORG_OWNER));
    const ready = async (p: Page) => {
      await p.getByLabel('Timezone').waitFor();
      await p.getByRole('button', { name: 'Save preferences' }).waitFor();
    };
    await screenshotRegional(page, 'owner-editable', { width: 1440, height: 900 }, ready);
    await screenshotRegional(page, 'owner-editable', { width: 390, height: 844 }, ready);
  });

  test('member read-only — desktop and mobile', async ({ page }) => {
    await installMocks(page, baseHandler(ORG_MEMBER));
    const ready = async (p: Page) => {
      await p.getByText('en-US').waitFor();
      await p.getByText(/can change regional preferences/).waitFor();
    };
    await screenshotRegional(page, 'member-readonly', { width: 1440, height: 900 }, ready);
    await screenshotRegional(page, 'member-readonly', { width: 390, height: 844 }, ready);
  });

  test('owner save success — desktop', async ({ page }) => {
    await installMocks(page, (method, apiPath) => {
      const base = baseHandler(ORG_OWNER)(method, apiPath);
      if (base) return base;
      if (method === 'PATCH' && apiPath === '/orgs/acme/settings') {
        return {
          status: 200,
          body: { ...ORG_SETTINGS, timezone: 'Europe/London', locale: 'en-GB' },
        };
      }
      return null;
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/o/acme/admin/general');
    await page.getByLabel('Timezone').selectOption('Europe/London');
    await page.getByLabel('Locale').selectOption('en-GB');
    await page.getByRole('button', { name: 'Save preferences' }).click();
    await page.getByText('Regional preferences saved.').waitFor();
    await page.locator('section[aria-labelledby="org-settings-regional"]').screenshot({
      path: path.join(OUT_DIR, 'owner-save-success-1440x900.png'),
    });
  });

  test('owner validation error — desktop and mobile', async ({ page }) => {
    await installMocks(page, (method, apiPath) => {
      const base = baseHandler(ORG_OWNER)(method, apiPath);
      if (base) return base;
      if (method === 'PATCH' && apiPath === '/orgs/acme/settings') {
        return {
          status: 422,
          body: {
            status: 422,
            code: 'validation_error',
            title: 'validation_error',
            request_id: 'req-visual',
            errors: [{ field: 'body.timezone', message: 'Unknown timezone.' }],
          },
        };
      }
      return null;
    });
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto('/o/acme/admin/general');
      await page.getByLabel('Timezone').selectOption('Europe/London');
      await page.getByRole('button', { name: 'Save preferences' }).click();
      await page.getByText('Unknown timezone.').waitFor();
      await page.locator('section[aria-labelledby="org-settings-regional"]').screenshot({
        path: path.join(OUT_DIR, `owner-validation-error-${viewport.width}x${viewport.height}.png`),
      });
    }
  });
});
