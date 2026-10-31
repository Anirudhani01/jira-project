import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

import { bootstrapKanbanProject } from './helpers';

test('create issue dialog — comboboxes, create another, axe', async ({ page, request }) => {
  const { slug, key } = await bootstrapKanbanProject(page, request, 'create-issue', {
    projectName: 'Create QA',
  });
  await page.goto(`/o/${slug}/p/${key}/issues`);

  await page.getByRole('button', { name: /^Create$/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Create issue' });
  await expect(dialog).toBeVisible();

  // Searchable pickers by keyboard: priority and assignee.
  await dialog.getByRole('combobox', { name: /^Priority/ }).click();
  await page.getByRole('combobox', { name: 'Search Priority' }).fill('high');
  await page.keyboard.press('Enter');
  await expect(dialog.getByRole('combobox', { name: /^Priority/ })).toContainText('High');

  await dialog.getByRole('combobox', { name: /^Assignee/ }).click();
  await page.getByRole('option', { name: /E2E User/ }).click();
  await expect(dialog.getByRole('combobox', { name: /^Assignee/ })).toContainText('E2E User');

  await dialog.getByLabel('Story points (optional)').fill('3');
  await dialog.getByLabel('Summary').fill('First of two');
  await dialog.getByRole('checkbox', { name: 'Create another' }).check();

  const results = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();
  const serious = results.violations.filter((v) =>
    ['serious', 'critical'].includes(v.impact ?? ''),
  );
  expect(serious.map((v) => `${v.id}: ${v.help}`)).toEqual([]);

  await dialog.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByText(`${key}-1 created`)).toBeVisible();
  await expect(dialog.getByLabel('Summary')).toHaveValue('');
  // Shared fields are kept for the next one.
  await expect(dialog.getByRole('combobox', { name: /^Priority/ })).toContainText('High');

  await dialog.getByLabel('Summary').fill('Second of two');
  await dialog.getByRole('checkbox', { name: 'Create another' }).uncheck();
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/issues/${key}-2`));
  await expect(page.getByRole('heading', { name: 'Second of two' })).toBeVisible();
});
