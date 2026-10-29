import { expect, test } from '@playwright/test';

import { axeAndScreenshot, expectThemed, setTheme, signUpAndSignIn } from './helpers';

for (const theme of ['light', 'dark'] as const) {
  test(`account page — axe and screenshot (${theme})`, async ({ page, request }) => {
    await setTheme(page, theme);
    const email = `acct-${Date.now().toString(36)}@example.com`;
    await signUpAndSignIn(page, request, email);
    await page.goto('/account');
    await expect(page.getByRole('heading', { name: 'Account' })).toBeVisible();
    await expectThemed(page, theme);
    await axeAndScreenshot(page, theme, '09-account');
  });
}
