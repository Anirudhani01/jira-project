import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

import { signUpAndSignIn } from './helpers';

test('project sidebar: keyboard navigation Board → Backlog → Issues', async ({ page, request }) => {
  const suffix = Date.now().toString(36);
  const email = `shell-${suffix}@example.com`;
  const slug = `sh${suffix}`.slice(0, 30);
  const key = `S${suffix
    .replace(/[^a-z]/g, '')
    .toUpperCase()
    .padEnd(2, 'X')
    .slice(0, 4)}`;

  await signUpAndSignIn(page, request, email);

  await page.goto('/orgs/new');
  await page.getByLabel('Name').fill(`Shell ${suffix}`);
  await page.getByLabel('Address').fill(slug);
  await page.getByRole('button', { name: 'Create organization' }).click();

  await page.goto(`/o/${slug}/projects/new?board_type=scrum&step=create`);
  await page.getByLabel('Name').fill('Scrum app');
  await page.getByLabel('Key').fill(key);
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.goto(`/o/${slug}/p/${key}/board`);

  const projectNav = page.getByRole('navigation', { name: 'Project' });
  await expect(projectNav).toBeVisible();

  await projectNav.getByRole('link', { name: 'Backlog' }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/p/${key}/backlog`));

  await projectNav.getByRole('link', { name: 'Issues' }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/p/${key}/issues`));

  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  const serious = results.violations.filter((v) =>
    ['serious', 'critical'].includes(v.impact ?? ''),
  );
  expect(serious.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
});
