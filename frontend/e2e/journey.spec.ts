import { expect, test } from '@playwright/test';

import {
  bootstrapKanbanProject,
  createIssueInDialog,
  expectNoSeriousViolations,
  issueLink,
} from './helpers';

/** Quick smoke path; PLAN §1.2 coverage is in `e2e/suites/mvp/scenarios.ts`. */

test('sign up, plan a project and move a card on the board', async ({ page, request }) => {
  const { slug, key } = await bootstrapKanbanProject(page, request, 'smoke', {
    projectName: 'Website',
  });

  await page.goto(`/o/${slug}/p/${key}/issues`);
  await createIssueInDialog(page, 'Login button misaligned');
  await expect(page.getByRole('heading', { name: 'Login button misaligned' })).toBeVisible();

  // Search finds it by text.
  await page.goto(`/o/${slug}/p/${key}/issues`);
  await page.getByRole('searchbox', { name: 'Search issues' }).fill('login');
  await page.locator('#main').getByRole('button', { name: 'Search', exact: true }).click();
  await expect(issueLink(page, `${key}-1`)).toBeVisible();

  await page.goto(`/o/${slug}/p/${key}/board`);
  await expect(page.getByRole('heading', { name: `${key} board` })).toBeVisible();
  const todo = page.getByRole('region', { name: /To Do/ });
  await expect(issueLink(page, `${key}-1`)).toBeVisible();
  await expectNoSeriousViolations(page);

  // Keyboard-friendly alternative to dragging: the card overflow "Move to" menu.
  await page.getByRole('button', { name: `More actions for ${key}-1` }).click();
  await page.getByRole('menuitem', { name: 'In Progress' }).click();
  const progress = page.getByRole('region', { name: /In Progress/ });
  await expect(progress.getByRole('link', { name: new RegExp(`${key}-1`, 'i') })).toBeVisible();
  await expect(todo.getByRole('link', { name: new RegExp(`${key}-1`, 'i') })).toHaveCount(0);

  // The notification bell and audit log are reachable and accessible.
  await page.goto(`/o/${slug}/settings/audit`);
  await expect(page.getByRole('heading', { name: 'Audit log' })).toBeVisible();
  await expectNoSeriousViolations(page);
});
