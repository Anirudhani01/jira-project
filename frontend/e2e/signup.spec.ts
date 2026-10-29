import { expect, test } from '@playwright/test';

import { axeAndScreenshot, expectThemed, setTheme } from './helpers';

for (const theme of ['light', 'dark'] as const) {
  test(`signup page — axe and screenshot (${theme})`, async ({ page }) => {
    await setTheme(page, theme);
    await page.goto('/signup');
    await expect(page.getByRole('heading', { name: 'Create an account' })).toBeVisible();
    await expectThemed(page, theme);
    await axeAndScreenshot(page, theme, '02-signup');
  });
}
