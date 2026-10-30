import { expect, test } from '@playwright/test';

import {
  axeAndScreenshot,
  bootstrapKanbanProject,
  expectNoSeriousViolations,
  expectThemed,
  setTheme,
} from './helpers';

for (const theme of ['light', 'dark'] as const) {
  test(`project settings — workflow, members, axe (${theme})`, async ({ page, request }) => {
    await setTheme(page, theme);
    const { slug, key } = await bootstrapKanbanProject(page, request, 'settings', {
      projectName: 'Shop (Kanban)',
    });

    await page.goto(`/o/${slug}/p/${key}`);
    await expect(page.getByRole('heading', { name: `${key} — Shop (Kanban)` })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Workflow' })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Board columns' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Members' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Project views' })).toBeVisible();

    await expectThemed(page, theme);
    await expectNoSeriousViolations(page);
    await axeAndScreenshot(page, theme, '10-project-settings');
  });
}
