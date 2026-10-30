import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

import { createOrganization, createProject, e2eIdentity, signUpAndSignIn } from './helpers';

test('project sidebar: keyboard navigation Board → Backlog → Issues', async ({ page, request }) => {
  const { email, slug, key, suffix } = e2eIdentity('shell');

  await signUpAndSignIn(page, request, email);
  await createOrganization(page, slug, `Shell ${suffix}`);
  await createProject(page, slug, key, 'Scrum app', 'scrum');
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
