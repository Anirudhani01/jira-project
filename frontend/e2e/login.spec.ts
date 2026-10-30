import { expect, test } from '@playwright/test';

import { axeAndScreenshot, expectThemed, setTheme } from './helpers';

for (const theme of ['light', 'dark'] as const) {
  test(`login page — axe and screenshot (${theme})`, async ({ page }) => {
    await setTheme(page, theme);
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Sign in to your workspace' })).toBeVisible();
    await expectThemed(page, theme);
    await axeAndScreenshot(page, theme, '02-login', {
      axeExclude: ['.auth-marketing-panel'],
    });
  });
}
