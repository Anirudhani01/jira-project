import { expect, test } from '@playwright/test';

import {
  A4A_MEMBER_PERMISSIONS,
  A4A_ORG_SLUG,
  A4A_PROJECT_KEY,
  createA4aMockContext,
  installA4aMockRouter,
  resetA4aTelemetry,
} from './a4a-fixtures';

test.describe('Admin Workflow Hub (A4a)', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('theme', 'light');
    });
  });

  test('owner inspects read-only workflow; member denied; project workflow tab still works', async ({
    page,
  }) => {
    const ctx = createA4aMockContext();
    await installA4aMockRouter(page, ctx);

    await page.goto(`/o/${A4A_ORG_SLUG}/admin/workflow`);
    await expect(page.getByRole('heading', { name: 'Workflows', level: 1 })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Administration' })).toContainText(
      'Workflows',
    );
    await expect(page.getByText(/cloned from the default workflow/i)).toBeVisible();

    await page
      .getByRole('button', {
        name: new RegExp(`Expand workflow details for ${A4A_PROJECT_KEY}`, 'i'),
      })
      .click();

    await expect(page.getByRole('heading', { name: 'Default workflow' })).toBeVisible();
    await expect(page.getByText('View only', { exact: true })).toBeVisible();
    const statusTable = page.getByRole('table', { name: 'Workflow statuses' });
    await expect(statusTable).toContainText('To Do');
    await expect(statusTable).toContainText('Initial');
    const transitionTable = page.getByRole('table', { name: 'Workflow transitions' });
    await expect(transitionTable).toContainText('Any status');
    await expect(page.getByRole('button', { name: /save/i })).toHaveCount(0);
    await expect(page.getByRole('textbox')).toHaveCount(0);
    expect(ctx.telemetry.workflowGets).toEqual([A4A_PROJECT_KEY]);
    expect(ctx.telemetry.hubArchivedProjectListGets).toBeGreaterThanOrEqual(1);

    resetA4aTelemetry(ctx);
    ctx.role = 'member';
    ctx.permissions = A4A_MEMBER_PERMISSIONS;
    ctx.displayName = 'Member User';
    ctx.projectPermissions = ['project.view'];
    ctx.activeProjects = [];
    ctx.archivedProjects = [];

    await page.goto(`/o/${A4A_ORG_SLUG}/admin/workflow`);
    await expect(page.getByRole('region', { name: /don't have access/i })).toBeVisible();
    await expect(page.getByText(/organization settings/i)).toBeVisible();
    expect(ctx.telemetry.hubArchivedProjectListGets).toBe(0);
    expect(ctx.telemetry.workflowGets).toHaveLength(0);
    expect(ctx.telemetry.shellActiveProjectListGets).toBeGreaterThanOrEqual(1);
    await expect(page.getByRole('link', { name: 'Workflows' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Expand workflow details/i })).toHaveCount(0);

    await page.goto(`/o/${A4A_ORG_SLUG}/p/${A4A_PROJECT_KEY}?tab=workflow`);
    await expect(page.getByRole('heading', { name: 'Default workflow' })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Workflow statuses' })).toBeVisible();
    await expect(page.getByText('View only', { exact: true })).toBeVisible();
  });
});
