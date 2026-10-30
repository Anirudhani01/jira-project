import { expect, test } from '@playwright/test';

import { axeAndScreenshot, expectThemed, setTheme, signUpAndCreateOrg } from './helpers';

for (const theme of ['light', 'dark'] as const) {
  test(`org home — axe and screenshot (${theme})`, async ({ page, request }) => {
    await setTheme(page, theme);
    const slug = await signUpAndCreateOrg(page, request, 'org-home');
    await page.goto(`/o/${slug}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByText('Welcome back,')).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Organization sections' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Organization overview' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Get started' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Plan, track, and ship great work' })).toBeVisible();
    const globalSearch = page.getByRole('combobox', { name: /search projects, issues, or people/i });
    await globalSearch.fill('org-home');
    await expect(page).toHaveURL(/\?q=org-home/);
    await expectThemed(page, theme);
    await axeAndScreenshot(page, theme, '03-org-home');
  });
}
