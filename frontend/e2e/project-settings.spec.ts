import { expect, test } from '@playwright/test';

import {
  A4A_ORG_SLUG,
  A4A_PROJECT_KEY,
  COL_DONE,
  COL_TODO,
  STATUS_DONE,
  STATUS_TODO,
  createA4aMockContext,
  installA4aMockRouter,
} from './a4a-fixtures';
import { axeAndScreenshot, expectNoSeriousViolations, expectThemed, setTheme } from './helpers';

for (const theme of ['light', 'dark'] as const) {
  test(`project settings — workflow editor, read-only columns (${theme})`, async ({ page }) => {
    const ctx = createA4aMockContext();
    await installA4aMockRouter(page, ctx);
    await setTheme(page, theme);

    await page.goto(`/o/${A4A_ORG_SLUG}/p/${A4A_PROJECT_KEY}?tab=workflow`);
    await expect(page.getByRole('heading', { name: 'Default workflow' })).toBeHidden();
    await expect(page.getByLabel('Workflow name')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save workflow' })).toBeDisabled();
    await page.getByLabel('Workflow name').fill('Team workflow');
    await expect(page.getByRole('button', { name: 'Save workflow' })).toBeEnabled();
    await page.getByRole('button', { name: 'Save workflow' }).click();
    await expect.poll(() => ctx.telemetry.workflowPutBodies.length).toBe(1);
    expect(ctx.telemetry.workflowPutHeaders[0]).toBe('"w1"');
    expect(ctx.telemetry.workflowPutBodies[0]).toMatchObject({ name: 'Team workflow' });
    expect(ctx.telemetry.boardColumnPutBodies.length).toBe(0);

    await page.goto(`/o/${A4A_ORG_SLUG}/p/${A4A_PROJECT_KEY}?tab=columns`);
    await expect(page.getByRole('link', { name: 'Workflow' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save columns' })).toHaveCount(0);
    const columnName = page.getByLabel('Column 1 name');
    await expect(columnName).toBeDisabled();

    await page.goto(`/o/${A4A_ORG_SLUG}/p/${A4A_PROJECT_KEY}?tab=members`);
    await expect(page.getByRole('heading', { name: 'Members', level: 2 })).toBeVisible();

    await expectThemed(page, theme);
    await expectNoSeriousViolations(page);
    await axeAndScreenshot(page, theme, '10-project-settings');
  });
}

test('project settings — viewer workflow is read-only', async ({ page }) => {
  const ctx = createA4aMockContext({
    role: 'member',
    permissions: ['org.view'],
    projectPermissions: ['project.view'],
  });
  await installA4aMockRouter(page, ctx);

  await page.goto(`/o/${A4A_ORG_SLUG}/p/${A4A_PROJECT_KEY}?tab=workflow`);
  await expect(page.getByText('View only', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /save workflow/i })).toHaveCount(0);
  await expect(page.getByLabel('Workflow name')).toHaveCount(0);
});
