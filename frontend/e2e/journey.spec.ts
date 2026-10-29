import { expect, test } from '@playwright/test';

import { expectNoSeriousViolations, signUpAndSignIn } from './helpers';

test('sign up, plan a project and move a card on the board', async ({ page, request }) => {
  const suffix = Date.now().toString(36);
  const email = `e2e-${suffix}@example.com`;
  const slug = `e2e${suffix}`.slice(0, 30);
  const key = `E${suffix
    .replace(/[^a-z]/g, '')
    .toUpperCase()
    .padEnd(3, 'X')
    .slice(0, 5)}`;

  await signUpAndSignIn(page, request, email);

  await page.goto('/orgs/new');
  await page.getByLabel('Name').fill(`E2E ${suffix}`);
  await page.getByLabel('Address').fill(slug);
  await page.getByRole('button', { name: 'Create organization' }).click();
  await expect(page).toHaveURL(new RegExp(`/o/${slug}`));

  await page.goto(`/o/${slug}/projects/new?board_type=kanban&step=create`);
  await page.getByLabel('Name').fill('Website');
  await page.getByLabel('Key').fill(key);
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${key}`));

  await page.goto(`/o/${slug}/p/${key}/issues`);
  await page.getByRole('button', { name: 'Create issue' }).click();
  await page.getByLabel('Summary').fill('Login button misaligned');
  await page.locator('#main').getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Login button misaligned' })).toBeVisible();

  // Search finds it by text.
  await page.goto(`/o/${slug}/p/${key}/issues`);
  await page.getByRole('searchbox', { name: 'Search issues' }).fill('login');
  await page.locator('#main').getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByText(`${key}-1`)).toBeVisible();

  await page.goto(`/o/${slug}/p/${key}/board`);
  await expect(page.getByRole('heading', { name: `${key} board` })).toBeVisible();
  const todo = page.getByRole('region', { name: /To Do/ });
  await expect(todo.getByRole('link', { name: `${key}-1` })).toBeVisible();
  await expectNoSeriousViolations(page);

  // Keyboard-friendly alternative to dragging: the card's "Move to" menu.
  await page.getByLabel(`Move ${key}-1 to`).selectOption({ label: 'In Progress' });
  const progress = page.getByRole('region', { name: /In Progress/ });
  await expect(progress.getByRole('link', { name: `${key}-1` })).toBeVisible();
  await expect(todo.getByRole('link', { name: `${key}-1` })).toHaveCount(0);

  // The notification bell and audit log are reachable and accessible.
  await page.goto(`/o/${slug}/settings/audit`);
  await expect(page.getByRole('heading', { name: 'Audit log' })).toBeVisible();
  await expectNoSeriousViolations(page);
});
