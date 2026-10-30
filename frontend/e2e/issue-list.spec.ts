import { expect, test } from '@playwright/test';

import {
  axeAndScreenshot,
  bootstrapKanbanProject,
  createIssueInDialog,
  expectNoSeriousViolations,
  expectThemed,
  setTheme,
} from './helpers';

for (const theme of ['light', 'dark'] as const) {
  test(`issue list — table, filters, axe (${theme})`, async ({ page, request }) => {
    await setTheme(page, theme);
    const { slug, key } = await bootstrapKanbanProject(page, request, 'issues', {
      projectName: 'Issue list QA',
    });

    await page.goto(`/o/${slug}/p/${key}/issues`);
    await createIssueInDialog(page, 'Checkout rounding bug');
    await page.goto(`/o/${slug}/p/${key}/issues`);
    await createIssueInDialog(page, 'Search API rate limit');

    await page.goto(`/o/${slug}/p/${key}/issues`);
    await expect(page.getByRole('heading', { name: `${key} issues` })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Issues' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sort by Issue' })).toBeVisible();
    await expect(page.getByText('Checkout rounding bug')).toBeVisible();

    await page.getByRole('button', { name: 'Sort by Issue' }).click();
    await expect(page).toHaveURL(/sort=-key/);
    await page.getByRole('button', { name: 'Sort by Issue' }).click();
    await expect(page).toHaveURL(/sort=key/);

    await expectThemed(page, theme);
    await expectNoSeriousViolations(page);
    await axeAndScreenshot(page, theme, '05-issues-list');
  });
}
