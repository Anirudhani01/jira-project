import { expect, test } from '@playwright/test';

import {
  axeAndScreenshot,
  bootstrapKanbanProject,
  createIssueInDialog,
  expectNoSeriousViolations,
  expectThemed,
  issueLink,
  setTheme,
} from './helpers';

for (const theme of ['light', 'dark'] as const) {
  test(`board — filter, menu move, keyboard drag, axe (${theme})`, async ({ page, request }) => {
    await setTheme(page, theme);
    const { slug, key } = await bootstrapKanbanProject(page, request, 'board', {
      projectName: 'Board QA',
    });

    await page.goto(`/o/${slug}/p/${key}/issues`);
    await createIssueInDialog(page, 'First card');
    await page.goto(`/o/${slug}/p/${key}/issues`);
    await createIssueInDialog(page, 'Second card');

    await page.goto(`/o/${slug}/p/${key}/board`);
    await expect(page.getByRole('heading', { name: `${key} board` })).toBeVisible();
    const todo = page.getByRole('region', { name: /To Do/i });
    await expect(todo.getByRole('link', { name: new RegExp(`${key}-1`, 'i') })).toBeVisible();
    await expect(todo.getByRole('link', { name: new RegExp(`${key}-2`, 'i') })).toBeVisible();

    await page.getByRole('searchbox', { name: 'Filter board' }).fill(`${key}-1`);
    await expect(todo.getByRole('link', { name: new RegExp(`${key}-2`, 'i') })).toHaveCount(0);
    await page.getByRole('button', { name: 'Clear' }).click();

    await page.getByRole('button', { name: `More actions for ${key}-1` }).click();
    await page.getByRole('menuitem', { name: 'In Progress' }).click();
    const progress = page.getByRole('region', { name: /In Progress/i });
    await expect(issueLink(page, `${key}-1`)).toBeVisible();

    const handle = page.getByRole('button', { name: new RegExp(`Drag ${key}-2:`) });
    await handle.focus();
    await page.keyboard.press('Space');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Space');
    await expect(progress.getByRole('link', { name: new RegExp(`${key}-2`, 'i') })).toBeVisible();

    await expectThemed(page, theme);
    await expectNoSeriousViolations(page);
    await axeAndScreenshot(page, theme, '06-board');
  });
}
