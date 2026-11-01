import fs from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import {
  FORBIDDEN_UI_STRINGS,
  formerMemberItem,
  loginSucceededItem,
  logoutItem,
  MEMBER_PERMISSIONS,
  mockAuthenticationActivityApi,
  mockSignedInOrgContext,
  OWNER_PERMISSIONS,
} from './auth-activity-fixtures';

const ORG_SLUG = 'acme-e2e-auth';
const SCREENSHOT_DIR =
  process.env.E2E_SCREENSHOTS ?? path.resolve(process.cwd(), '../.tmp/a32-phase5-screenshots');

test.describe('Authentication Activity (A3.2 Phase 5)', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('theme', 'light');
    });
  });

  test('owner and admin can open the page; member is denied without activity fetch', async ({
    page,
  }) => {
    await mockSignedInOrgContext(page, {
      orgSlug: ORG_SLUG,
      role: 'owner',
      permissions: OWNER_PERMISSIONS,
    });
    const { calls } = await mockAuthenticationActivityApi(page, () => ({
      body: { items: [loginSucceededItem()], next_cursor: null },
    }));
    await page.goto(`/o/${ORG_SLUG}/admin/security/activity`);
    await expect(
      page.getByRole('heading', { name: 'Authentication Activity', level: 1 }),
    ).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Administration' })).toContainText(
      'Authentication Activity',
    );
    expect(calls.length).toBeGreaterThan(0);

    await mockSignedInOrgContext(page, {
      orgSlug: ORG_SLUG,
      role: 'admin',
      permissions: OWNER_PERMISSIONS,
      displayName: 'Admin User',
    });
    await mockAuthenticationActivityApi(page, () => ({
      body: { items: [loginSucceededItem()], next_cursor: null },
    }));
    await page.goto(`/o/${ORG_SLUG}/admin/security/activity`);
    await expect(
      page.getByRole('heading', { name: 'Authentication Activity', level: 1 }),
    ).toBeVisible();

    let activityRequests = 0;
    await page.route('**/api/v1/orgs/*/authentication-activity**', async (route) => {
      activityRequests += 1;
      await route.fulfill({ status: 403, contentType: 'application/json', body: '{}' });
    });
    await mockSignedInOrgContext(page, {
      orgSlug: ORG_SLUG,
      role: 'member',
      permissions: MEMBER_PERMISSIONS,
      displayName: 'Member User',
    });
    await page.goto(`/o/${ORG_SLUG}/admin/security/activity`);
    await expect(page.getByText(/owners and admins/i)).toBeVisible();
    expect(activityRequests).toBe(0);
  });

  test('audit logs admin route remains available and unchanged', async ({ page }) => {
    await mockSignedInOrgContext(page, {
      orgSlug: ORG_SLUG,
      role: 'owner',
      permissions: OWNER_PERMISSIONS,
    });
    await page.route(`**/api/v1/orgs/${ORG_SLUG}/audit-events**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [], next_cursor: null }),
      });
    });
    await page.goto(`/o/${ORG_SLUG}/admin/audit`);
    await expect(page.getByRole('heading', { name: 'Audit Logs', level: 1 })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Filters' })).toBeVisible();
    await expect(page.getByLabel('Action')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Authentication Activity' })).toHaveCount(0);
  });

  test('filters sync to URL, pagination resets on filter change, and metadata expands', async ({
    page,
  }) => {
    await mockSignedInOrgContext(page, {
      orgSlug: ORG_SLUG,
      role: 'owner',
      permissions: OWNER_PERMISSIONS,
    });
    const { calls } = await mockAuthenticationActivityApi(page, (url) => {
      const params = url.searchParams;
      if (params.get('event_type') === 'auth.logout') {
        return { body: { items: [logoutItem()], next_cursor: null } };
      }
      if (params.get('cursor') === 'cursor-page-2') {
        return { body: { items: [logoutItem({ id: 1003 })], next_cursor: null } };
      }
      return {
        body: {
          items: [loginSucceededItem()],
          next_cursor: 'cursor-page-2',
        },
      };
    });

    await page.goto(`/o/${ORG_SLUG}/admin/security/activity`);
    await expect(page.locator('#auth-activity-table-heading')).toBeVisible();
    await page.getByLabel('Event type').selectOption('auth.login.succeeded');
    await expect(page).toHaveURL(/event_type=auth\.login\.succeeded/);
    await page.getByLabel('Member').selectOption({ index: 1 });
    await expect(page).toHaveURL(/member=/);

    await page.goto(`/o/${ORG_SLUG}/admin/security/activity`);
    await expect(page.getByRole('button', { name: 'Load more' })).toBeVisible();
    await page.getByRole('button', { name: 'Load more' }).click();
    await expect
      .poll(() => calls.some((u) => u.searchParams.get('cursor') === 'cursor-page-2'))
      .toBe(true);
    await expect(page.getByRole('table').getByText('Signed out')).toBeVisible();

    await page
      .getByRole('button', { name: /Show metadata for Sign-in succeeded for Owner User/i })
      .click();
    await expect(page.getByText(/"sessions_evicted": 2/)).toBeVisible();

    await page.getByLabel('Event type').selectOption('auth.logout');
    await expect(page).toHaveURL(/event_type=auth\.logout/);
    await expect
      .poll(() => calls.filter((u) => u.searchParams.get('event_type') === 'auth.logout').length)
      .toBeGreaterThan(0);
    const logoutCalls = calls.filter((u) => u.searchParams.get('event_type') === 'auth.logout');
    expect(logoutCalls[logoutCalls.length - 1]?.searchParams.get('cursor')).toBeNull();
  });

  test('loading, empty, and API error states', async ({ page }) => {
    await mockSignedInOrgContext(page, {
      orgSlug: ORG_SLUG,
      role: 'owner',
      permissions: OWNER_PERMISSIONS,
    });
    await mockAuthenticationActivityApi(page, () => ({
      delayMs: 600,
      body: { items: [], next_cursor: null },
    }));
    await page.goto(`/o/${ORG_SLUG}/admin/security/activity`);
    await expect(
      page.getByRole('status', { name: /Loading authentication activity/i }),
    ).toBeVisible();
    await expect(page.getByText(/No authentication activity has been recorded/)).toBeVisible({
      timeout: 15_000,
    });

    await mockAuthenticationActivityApi(page, () => ({
      body: { items: [], next_cursor: null },
    }));
    await page.goto(`/o/${ORG_SLUG}/admin/security/activity?event_type=auth.logout`);
    await expect(page.getByText(/No activity matches the selected filters/)).toBeVisible();

    await mockAuthenticationActivityApi(page, () => ({ status: 500 }));
    await page.goto(`/o/${ORG_SLUG}/admin/security/activity`);
    await expect(page.getByRole('button', { name: /retry/i })).toBeVisible();
    await expect(page.getByText(/simulated failure/i)).toHaveCount(0);
  });

  test('captures desktop and mobile screenshots from the live UI', async ({ page }) => {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    await mockSignedInOrgContext(page, {
      orgSlug: ORG_SLUG,
      role: 'owner',
      permissions: OWNER_PERMISSIONS,
    });
    await mockAuthenticationActivityApi(page, () => ({
      body: {
        items: [loginSucceededItem(), formerMemberItem()],
        next_cursor: null,
      },
    }));

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/o/${ORG_SLUG}/admin/security/activity`);
    await expect(
      page.getByRole('heading', { name: 'Authentication Activity', level: 1 }),
    ).toBeVisible();
    await expect(page.getByText('Removed').first()).toBeVisible();
    await expect(page.getByRole('table').getByText('Former Teammate')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Clear filters' })).toHaveCount(0);
    await expect(page.getByText('Export')).toHaveCount(0);

    const desktopText = await page.locator('#main').innerText();
    for (const forbidden of FORBIDDEN_UI_STRINGS) {
      expect(desktopText).not.toContain(forbidden);
    }

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'authentication-activity-desktop-1440x900.png'),
      fullPage: true,
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/o/${ORG_SLUG}/admin/security/activity`);
    await expect(page.getByRole('list', { name: 'Authentication activity' })).toBeVisible();
    const mobileText = await page.locator('#main').innerText();
    for (const forbidden of FORBIDDEN_UI_STRINGS) {
      expect(mobileText).not.toContain(forbidden);
    }
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'authentication-activity-mobile-390x844.png'),
      fullPage: true,
    });
  });
});
