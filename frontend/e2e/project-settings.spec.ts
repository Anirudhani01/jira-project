import { expect, test } from '@playwright/test';

import {
  A4A_ORG_SLUG,
  A4A_PROJECT_KEY,
  COL_DONE,
  COL_TODO,
  STATUS_DONE,
  STATUS_PROGRESS,
  STATUS_TODO,
  createA4aMockContext,
  installA4aMockRouter,
} from './a4a-fixtures';
import { axeAndScreenshot, expectNoSeriousViolations, expectThemed, setTheme } from './helpers';

for (const theme of ['light', 'dark'] as const) {
  test(`project settings — workflow, columns, axe (${theme})`, async ({ page }) => {
    const ctx = createA4aMockContext();
    await installA4aMockRouter(page, ctx);
    await setTheme(page, theme);

    await page.goto(`/o/${A4A_ORG_SLUG}/p/${A4A_PROJECT_KEY}`);
    await expect(
      page.getByRole('heading', { name: `${A4A_PROJECT_KEY} — Shop (Kanban)` }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Details', level: 2 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Members', level: 2 })).toBeHidden();
    await expect(page.getByRole('navigation', { name: 'Project views' })).toBeVisible();

    await page.goto(`/o/${A4A_ORG_SLUG}/p/${A4A_PROJECT_KEY}?tab=workflow`);
    await expect(page.getByRole('heading', { name: 'Default workflow' })).toBeVisible();
    await expect(page.getByText('Read-only', { exact: true })).toBeVisible();
    await expect(page.getByText('Project WEB · Shop (Kanban)')).toBeVisible();
    const statusTable = page.getByRole('table', { name: 'Workflow statuses' });
    await expect(statusTable).toContainText('To Do');
    await expect(statusTable).toContainText('In Progress');
    await expect(statusTable).toContainText('Initial');
    const transitionTable = page.getByRole('table', { name: 'Workflow transitions' });
    await expect(transitionTable).toContainText('Any status');
    await expect(page.getByRole('button', { name: /save/i })).toHaveCount(0);
    await expect(page.getByRole('textbox')).toHaveCount(0);

    await page.goto(`/o/${A4A_ORG_SLUG}/p/${A4A_PROJECT_KEY}?tab=columns`);
    const columnName = page.getByLabel('Column 1 name');
    await expect(columnName).toBeEnabled();
    await columnName.fill('Backlog');
    await page.getByLabel('WIP limit').first().fill('5');
    await expect(page.getByRole('button', { name: 'Save columns' })).toBeEnabled();
    await page.getByRole('button', { name: 'Save columns' }).click();
    await expect.poll(() => ctx.telemetry.boardColumnPutBodies.length).toBe(1);
    expect(ctx.telemetry.boardColumnPutBodies[0]).toEqual({
      columns: [
        {
          id: COL_TODO,
          name: 'Backlog',
          wip_limit: 5,
          status_ids: [STATUS_TODO, STATUS_PROGRESS],
        },
        { id: COL_DONE, name: 'Done', wip_limit: 3, status_ids: [STATUS_DONE] },
      ],
    });

    await page.goto(`/o/${A4A_ORG_SLUG}/p/${A4A_PROJECT_KEY}?tab=members`);
    await expect(page.getByRole('heading', { name: 'Members', level: 2 })).toBeVisible();

    await expectThemed(page, theme);
    await expectNoSeriousViolations(page);
    await axeAndScreenshot(page, theme, '10-project-settings');
  });
}
