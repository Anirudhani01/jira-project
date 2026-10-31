import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

import { createOrganization, createProject, e2eIdentity, signUpAndSignIn } from './helpers';

test('scrum backlog — inline create, bulk move, start and complete a sprint, axe', async ({
  page,
  request,
}) => {
  const { email, slug, key, suffix } = e2eIdentity('backlog');
  await signUpAndSignIn(page, request, email);
  await createOrganization(page, slug, `Backlog ${suffix}`);
  await createProject(page, slug, key, 'Backlog QA', 'scrum');
  await page.goto(`/o/${slug}/p/${key}/backlog`);
  await expect(page.getByRole('heading', { name: `${key} backlog` })).toBeVisible();

  await page.getByLabel('Sprint name').fill('Sprint 1');
  await page.getByRole('button', { name: 'Create sprint' }).click();
  const sprint = page.getByRole('region', { name: 'Sprint 1', exact: true });
  await expect(sprint).toBeVisible();
  await expect(sprint.getByText('Plan your sprint')).toBeVisible();

  const backlog = page.getByRole('region', { name: 'Backlog', exact: true });
  for (const summary of ['First task', 'Second task', 'Third task']) {
    await backlog.getByRole('button', { name: 'Create issue' }).click();
    await backlog.getByLabel('Summary for the new issue').fill(summary);
    await page.keyboard.press('Enter');
    await expect(backlog.getByText(summary)).toBeVisible();
    await backlog.getByLabel('Summary for the new issue').press('Escape');
  }

  // Multi-select two issues and move them into the sprint.
  await backlog.getByRole('checkbox', { name: `Select ${key}-1` }).click();
  await backlog.getByRole('checkbox', { name: `Select ${key}-2` }).click();
  const bar = page.getByRole('region', { name: 'Bulk actions' });
  await expect(bar.getByText('2 selected')).toBeVisible();
  await bar.getByLabel('Move to').selectOption({ label: 'Sprint 1' });
  await bar.getByRole('button', { name: 'Move', exact: true }).click();
  await expect(sprint.getByText('First task')).toBeVisible();
  await expect(sprint.getByText('Second task')).toBeVisible();
  await expect(backlog.getByText('Third task')).toBeVisible();

  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  const serious = results.violations.filter((v) =>
    ['serious', 'critical'].includes(v.impact ?? ''),
  );
  expect(serious.map((v) => `${v.id}: ${v.help}`)).toEqual([]);

  await sprint.getByRole('button', { name: 'Start sprint' }).click();
  const start = page.getByRole('dialog', { name: 'Start Sprint 1' });
  await start.getByRole('button', { name: 'Start sprint' }).click();
  await expect(sprint.getByText('Active')).toBeVisible();

  await sprint.getByRole('button', { name: 'Complete sprint' }).click();
  const complete = page.getByRole('dialog', { name: 'Complete Sprint 1' });
  await complete.getByRole('button', { name: 'Complete sprint' }).click();
  await expect(page.getByText('Sprint 1 completed').first()).toBeVisible();
});
