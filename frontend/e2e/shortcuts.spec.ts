import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { bootstrapKanbanProject, createIssueInDialog } from './helpers';

async function expectNoSeriousViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  const serious = results.violations.filter((v) =>
    ['serious', 'critical'].includes(v.impact ?? ''),
  );
  expect(serious.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
}

test('keyboard shortcuts and the command palette', async ({ page, request }) => {
  const { slug, key } = await bootstrapKanbanProject(page, request, 'keys', {
    projectName: 'Keys QA',
  });
  await page.goto(`/o/${slug}/p/${key}/issues`);
  await createIssueInDialog(page, 'First thing');
  await page.goto(`/o/${slug}/p/${key}/issues`);
  await createIssueInDialog(page, 'Second thing');
  await page.goto(`/o/${slug}/p/${key}/board`);
  await expect(page.getByRole('heading', { name: `${key} board` })).toBeVisible();

  // ? opens the cheat sheet (accessible), Escape closes it.
  await page.keyboard.press('?');
  const help = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(help).toBeVisible();
  await expect(help.getByText('G then B')).toBeVisible();
  await expectNoSeriousViolations(page);
  await page.keyboard.press('Escape');
  await expect(help).toBeHidden();

  // C creates; the dialog is a modal, so single keys stop working inside it.
  await page.keyboard.press('c');
  const create = page.getByRole('dialog', { name: 'Create issue' });
  await expect(create).toBeVisible();
  await create.getByLabel('Summary').fill('Made with the keyboard');
  await create.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Made with the keyboard' })).toBeVisible();

  // G then I goes to the issue list; J / K move through rows; O opens the selected issue.
  await page.keyboard.press('g');
  await page.keyboard.press('i');
  await expect(page).toHaveURL(new RegExp(`/p/${key}/issues`));
  const rows = page.locator('[data-issue-row]');
  await expect(rows).toHaveCount(3);
  await page.keyboard.press('j');
  const first = rows.nth(0).locator('a[href*="/issues/"]').first();
  await expect(first).toBeFocused();
  await page.keyboard.press('j');
  await expect(rows.nth(1).locator('a[href*="/issues/"]').first()).toBeFocused();
  await page.keyboard.press('k');
  await expect(first).toBeFocused();
  await page.keyboard.press('o');
  await expect(page).toHaveURL(new RegExp(`/issues/${key}-\\d+`));

  // The palette: Ctrl+K, search an issue by text, open it.
  await page.goto(`/o/${slug}/p/${key}/board`);
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await expect(palette).toBeVisible();
  await palette.getByRole('combobox').fill('/second');
  await expect(palette.getByText('Second thing')).toBeVisible();
  await expectNoSeriousViolations(page);
  await palette.getByText('Second thing').click();
  await expect(page.getByRole('heading', { name: 'Second thing' })).toBeVisible();

  // M focuses the comment box on an issue.
  await page.keyboard.press('m');
  await expect(page.getByLabel('Add a comment')).toBeFocused();
});
