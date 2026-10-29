import { expect, test } from '@playwright/test';

import { axeAndScreenshot, expectThemed, setTheme, signUpAndCreateOrg } from './helpers';

for (const theme of ['light', 'dark'] as const) {
  test(`org home — axe and screenshot (${theme})`, async ({ page, request }) => {
    await setTheme(page, theme);
    const slug = await signUpAndCreateOrg(page, request, 'org-home');
    await page.goto(`/o/${slug}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expectThemed(page, theme);
    await axeAndScreenshot(page, theme, '03-org-home');
  });
}
