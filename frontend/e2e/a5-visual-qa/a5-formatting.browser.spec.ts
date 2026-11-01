/**
 * A5.4 browser verification — mocked API, real React app.
 * Run: E2E_BASE_URL=http://127.0.0.1:5176 pnpm exec playwright test e2e/a5-visual-qa
 */
import { expect, test } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createOrgFormatters } from '../../src/lib/orgFormatting';

import {
  A5_AUDIT_EVENT,
  A5_AUTH_ACTIVITY_ITEM,
  A5_ORG_OWNER,
  installA5OrgMocks,
} from './a5-fixtures';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '../../visual-qa/a5.4');

const AUDIT_ISO = A5_AUDIT_EVENT.created_at;
const ORG_CREATED_ISO = A5_ORG_OWNER.created_at;

test.describe('A5 organization formatting (browser)', () => {
  test('UTC timezone — General Created, audit and auth timestamps', async ({ page }) => {
    await installA5OrgMocks(page, {
      settings: { timezone: 'UTC', locale: 'en-US', updated_at: '2026-10-27T00:00:00Z' },
    });
    const expected = createOrgFormatters({ timezone: 'UTC', locale: 'en-US' });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/o/acme/admin/general');
    const created = page.locator('dt', { hasText: 'Created' }).locator('..').locator('time');
    await expect(created).toHaveAttribute('dateTime', ORG_CREATED_ISO);
    await expect(created).toHaveText(expected.formatDateTime(ORG_CREATED_ISO));

    await page.goto('/o/acme/admin/audit');
    const auditTime = page.locator('time[datetime="' + AUDIT_ISO + '"]');
    await expect(auditTime).toHaveText(expected.formatDateTime(AUDIT_ISO));

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/o/acme/admin/security/activity');
    await expect(
      page.locator('time[datetime="' + A5_AUTH_ACTIVITY_ITEM.occurred_at + '"]'),
    ).toHaveText(expected.formatDateTime(A5_AUTH_ACTIVITY_ITEM.occurred_at));

    await page.goto('/o/acme/admin/general');
    await page.locator('section[aria-labelledby="org-settings-details"]').screenshot({
      path: path.join(OUT_DIR, 'format-utc-general-created-1440x900.png'),
    });
  });

  test('Asia/Kolkata timezone updates displayed instants', async ({ page }) => {
    await installA5OrgMocks(page, {
      settings: { timezone: 'Asia/Kolkata', locale: 'en-US', updated_at: '2026-10-27T00:00:00Z' },
    });
    const expected = createOrgFormatters({ timezone: 'Asia/Kolkata', locale: 'en-US' });

    await page.goto('/o/acme/admin/audit');
    const auditTime = page.locator('time[datetime="' + AUDIT_ISO + '"]');
    await expect(auditTime).toHaveAttribute('dateTime', AUDIT_ISO);
    await expect(auditTime).toHaveText(expected.formatDateTime(AUDIT_ISO));

    await page.screenshot({
      path: path.join(OUT_DIR, 'format-asia-kolkata-audit-1440x900.png'),
      fullPage: false,
    });
  });

  test('America/New_York timezone and DST wall time', async ({ page }) => {
    await installA5OrgMocks(page, {
      settings: {
        timezone: 'America/New_York',
        locale: 'en-US',
        updated_at: '2026-10-27T00:00:00Z',
      },
    });
    const ny = createOrgFormatters({ timezone: 'America/New_York', locale: 'en-US' });
    const dstIso = '2026-03-08T07:30:00.000Z';

    await page.route('**/api/v1/orgs/acme/audit-events**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: [{ ...A5_AUDIT_EVENT, created_at: dstIso }],
          next_cursor: null,
        }),
      });
    });

    await page.goto('/o/acme/admin/audit');
    const auditTime = page.locator('time[datetime="' + dstIso + '"]');
    await expect(auditTime).toHaveAttribute('dateTime', dstIso);
    await expect(auditTime).toHaveText(ny.formatDateTime(dstIso));
    expect(ny.formatDateTime(dstIso)).toMatch(/3:30/);
  });

  test('locale change updates formatting', async ({ page }) => {
    await installA5OrgMocks(page, {
      settings: { timezone: 'UTC', locale: 'de-DE', updated_at: '2026-10-27T00:00:00Z' },
    });
    const de = createOrgFormatters({ timezone: 'UTC', locale: 'de-DE' });

    await page.goto('/o/acme/admin/general');
    const created = page.locator('dt', { hasText: 'Created' }).locator('..').locator('time');
    await expect(created).toHaveText(de.formatDateTime(ORG_CREATED_ISO));
    await page.locator('section[aria-labelledby="org-settings-details"]').screenshot({
      path: path.join(OUT_DIR, 'format-locale-de-general-1440x900.png'),
    });
  });

  test('saving regional preferences refreshes formatter output without reload', async ({
    page,
  }) => {
    const mocks = await installA5OrgMocks(page, {
      settings: { timezone: 'UTC', locale: 'en-US', updated_at: '2026-10-27T00:00:00Z' },
    });
    const utc = createOrgFormatters({ timezone: 'UTC', locale: 'en-US' });
    const kolkata = createOrgFormatters({ timezone: 'Asia/Kolkata', locale: 'en-US' });

    await page.goto('/o/acme/admin/general');
    const created = page.locator('dt', { hasText: 'Created' }).locator('..').locator('time');
    await expect(created).toHaveText(utc.formatDateTime(ORG_CREATED_ISO));

    await page.getByLabel('Timezone').selectOption('Asia/Kolkata');
    await page.getByRole('button', { name: 'Save preferences' }).click();
    await expect(page.getByText('Regional preferences saved.')).toBeVisible();
    expect(mocks.getSettings().timezone).toBe('Asia/Kolkata');

    await expect(created).toHaveText(kolkata.formatDateTime(ORG_CREATED_ISO));
    await page.locator('section[aria-labelledby="org-settings-regional"]').screenshot({
      path: path.join(OUT_DIR, 'format-save-refreshes-provider-1440x900.png'),
    });
  });

  test('settings GET is deduplicated across provider and General settings', async ({ page }) => {
    const mocks = await installA5OrgMocks(page, {
      settings: { timezone: 'UTC', locale: 'en-US', updated_at: '2026-10-27T00:00:00Z' },
    });
    await page.goto('/o/acme/admin/general');
    await page.getByLabel('Timezone').waitFor();
    await expect.poll(() => mocks.getSettingsGetCount()).toBe(1);
  });
});

test.describe('A5 raw ISO preservation', () => {
  test('dateTime attributes keep UTC ISO strings', async ({ page }) => {
    await installA5OrgMocks(page, {
      settings: { timezone: 'Asia/Kolkata', locale: 'fr-FR', updated_at: '2026-10-27T00:00:00Z' },
    });
    await page.goto('/o/acme/admin/audit');
    await expect(page.locator('time[datetime="' + AUDIT_ISO + '"]')).toHaveAttribute(
      'dateTime',
      AUDIT_ISO,
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/o/acme/admin/security/activity');
    await expect(
      page.locator('time[datetime="' + A5_AUTH_ACTIVITY_ITEM.occurred_at + '"]'),
    ).toHaveAttribute('dateTime', A5_AUTH_ACTIVITY_ITEM.occurred_at);
  });
});
