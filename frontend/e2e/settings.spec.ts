import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { createOrganization, createProject, e2eIdentity, signUpAndSignIn } from './helpers';

async function noSeriousViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  const serious = results.violations.filter((v) =>
    ['serious', 'critical'].includes(v.impact ?? ''),
  );
  expect(serious.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
}

test('project settings: rename a board column and set a WIP limit, see it on the board', async ({
  page,
  request,
}) => {
  const { email, slug, key, suffix } = e2eIdentity('settings');
  await signUpAndSignIn(page, request, email);
  await createOrganization(page, slug, `Settings ${suffix}`);
  await createProject(page, slug, key, 'Kanban app', 'kanban');

  await page.goto(`/o/${slug}/p/${key}?tab=columns`);
  const name = page.getByLabel('Column 1 name');
  await expect(name).toBeVisible();
  await noSeriousViolations(page);

  await name.fill('Ideas');
  await page.getByLabel('WIP limit').first().fill('4');
  await page.getByRole('button', { name: 'Save columns' }).click();
  await expect(page.getByText('Board columns saved', { exact: true })).toBeVisible();

  await page.goto(`/o/${slug}/p/${key}/board`);
  await expect(page.getByRole('heading', { name: /Ideas/ }).first()).toBeVisible();
});

test('audit log and notifications popover have no serious a11y violations', async ({
  page,
  request,
}) => {
  const { email, slug, suffix } = e2eIdentity('auditux');
  await signUpAndSignIn(page, request, email);
  await createOrganization(page, slug, `Audit ${suffix}`);

  await page.goto(`/o/${slug}/settings/audit`);
  await expect(page.getByRole('heading', { name: 'Audit log' })).toBeVisible();
  await noSeriousViolations(page);

  await page.goto(`/o/${slug}`);
  await page.getByRole('button', { name: /Notifications/ }).click();
  await expect(page.getByText('You are all caught up.')).toBeVisible();
  await noSeriousViolations(page);
});
