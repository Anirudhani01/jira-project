import { expect, test } from '@playwright/test';

import { axeAndScreenshot, expectThemed, setTheme, signUpAndCreateOrg } from './helpers';

for (const theme of ['light', 'dark'] as const) {
  test(`create project form — axe and screenshot (${theme})`, async ({ page, request }) => {
    await setTheme(page, theme);
    const slug = await signUpAndCreateOrg(page, request, 'create-proj');
    await page.goto(`/o/${slug}/projects/new?board_type=kanban&step=create`);
    await expect(page.getByRole('heading', { name: 'Create a project' })).toBeVisible();
    await expectThemed(page, theme);
    await axeAndScreenshot(page, theme, '03-create-project');
  });
}
