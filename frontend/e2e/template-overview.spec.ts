import { expect, test } from '@playwright/test';

import { axeAndScreenshot, expectThemed, setTheme, signUpAndCreateOrg } from './helpers';

for (const theme of ['light', 'dark'] as const) {
  test(`kanban template overview — axe and screenshot (${theme})`, async ({ page, request }) => {
    await setTheme(page, theme);
    const slug = await signUpAndCreateOrg(page, request, 'template');
    await page.goto(`/o/${slug}/projects/new?board_type=kanban`);
    await expect(page.getByRole('heading', { name: 'Kanban template' })).toBeVisible();
    await expect(page.getByText('Template overview')).toBeVisible();
    await expectThemed(page, theme);
    await axeAndScreenshot(page, theme, '03-template-overview-kanban');
  });
}
