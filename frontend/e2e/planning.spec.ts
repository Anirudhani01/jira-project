import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

import { createOrganization, createProject, e2eIdentity, signUpAndSignIn } from './helpers';

test('backlog planning — epics panel, versions panel, bulk actions, release, axe', async ({
  page,
  request,
}) => {
  const { email, slug, key, suffix } = e2eIdentity('plan');
  await signUpAndSignIn(page, request, email);
  await createOrganization(page, slug, `Plan ${suffix}`);
  await createProject(page, slug, key, 'Plan QA', 'scrum');
  await page.goto(`/o/${slug}/p/${key}/backlog`);
  await expect(page.getByRole('heading', { name: `${key} backlog` })).toBeVisible();

  const backlog = page.getByRole('region', { name: 'Backlog', exact: true });
  for (const summary of ['Pay with card', 'Refund an order']) {
    await backlog.getByRole('button', { name: 'Create issue' }).click();
    await backlog.getByLabel('Summary for the new issue').fill(summary);
    await page.keyboard.press('Enter');
    await expect(backlog.getByText(summary)).toBeVisible();
    await backlog.getByLabel('Summary for the new issue').press('Escape');
  }

  // Epics panel (key E): create an epic, put both issues in it with the bulk bar, filter by it.
  await page.keyboard.press('e');
  const epics = page.getByRole('complementary', { name: 'Epics panel' });
  await expect(epics).toBeVisible();
  await epics.getByRole('button', { name: 'Create epic' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create issue' });
  await expect(dialog.getByRole('combobox', { name: /^Type/ })).toContainText('Epic');
  await dialog.getByLabel('Summary').fill('Checkout');
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();
  await page.goto(`/o/${slug}/p/${key}/backlog`);
  await page.keyboard.press('e');
  await expect(epics.getByText('Checkout')).toBeVisible();

  await backlog.getByRole('checkbox', { name: `Select ${key}-1` }).click();
  await backlog.getByRole('checkbox', { name: `Select ${key}-2` }).click();
  const bar = page.getByRole('region', { name: 'Bulk actions' });
  await bar.getByLabel('Action').selectOption({ label: 'Set epic' });
  await bar.getByLabel('Value').selectOption({ label: `${key}-3 Checkout` });
  await bar.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByText('2 issues updated').first()).toBeVisible();
  await expect(epics.getByText('0/2 done')).toBeVisible();
  await epics.getByRole('button', { name: /Checkout/ }).click();
  await expect(backlog.getByText('Pay with card')).toBeVisible();
  await epics.getByRole('button', { name: 'All issues' }).click();

  // Versions panel (key V): create 1.0, assign one issue, release moving unresolved to 2.0.
  await page.keyboard.press('v');
  const versions = page.getByRole('complementary', { name: 'Versions panel' });
  await versions.getByRole('button', { name: 'Create version' }).click();
  const create = page.getByRole('dialog', { name: 'Create version' });
  await create.getByLabel('Name').fill('1.0');
  await create.getByRole('button', { name: 'Create version' }).click();
  await expect(versions.getByText('1.0', { exact: true })).toBeVisible();
  await versions.getByRole('button', { name: 'Create version' }).click();
  await page.getByRole('dialog', { name: 'Create version' }).getByLabel('Name').fill('2.0');
  await page
    .getByRole('dialog', { name: 'Create version' })
    .getByRole('button', { name: 'Create version' })
    .click();
  await expect(versions.getByText('2.0', { exact: true })).toBeVisible();

  await backlog.getByRole('checkbox', { name: `Select ${key}-1` }).click();
  const bar2 = page.getByRole('region', { name: 'Bulk actions' });
  await bar2.getByLabel('Action').selectOption({ label: 'Set fix version' });
  await bar2.getByLabel('Value').selectOption({ label: '1.0' });
  await bar2.getByRole('button', { name: 'Apply' }).click();
  await expect(versions.getByText('0/1 done')).toBeVisible();

  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  const serious = results.violations.filter((v) =>
    ['serious', 'critical'].includes(v.impact ?? ''),
  );
  expect(serious.map((v) => `${v.id}: ${v.help}`)).toEqual([]);

  await versions.getByRole('button', { name: 'Version actions for 1.0' }).click();
  await page.getByRole('menuitem', { name: 'Release' }).click();
  const release = page.getByRole('dialog', { name: 'Release 1.0' });
  await release.getByRole('radio', { name: 'Move them to another version' }).check();
  await release.getByRole('button', { name: 'Release version' }).click();
  await expect(page.getByText('1.0 released').first()).toBeVisible();
  await expect(versions.getByText('released', { exact: true })).toBeVisible();
});
