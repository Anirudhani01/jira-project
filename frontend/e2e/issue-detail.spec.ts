import { expect, test } from '@playwright/test';

import {
  axeAndScreenshot,
  bootstrapKanbanProject,
  createIssueInDialog,
  expectNoSeriousViolations,
  expectThemed,
  issueLink,
  setTheme,
} from './helpers';

for (const theme of ['light', 'dark'] as const) {
  test(`issue detail — full page, activity tabs, axe (${theme})`, async ({ page, request }) => {
    await setTheme(page, theme);
    const { slug, key } = await bootstrapKanbanProject(page, request, `detail-${theme}`, {
      projectName: 'Issue detail QA',
    });

    await page.goto(`/o/${slug}/p/${key}/issues`);
    await createIssueInDialog(page, 'Detail screenshot issue', undefined, {
      expectDetailNav: true,
    });

    await page.getByRole('button', { name: 'Edit description' }).click();
    await page.getByRole('button', { name: 'Preview' }).click();
    await page.getByRole('button', { name: 'Write' }).click();
    await page
      .getByRole('textbox', { name: 'Description' })
      .fill('**Acceptance** criteria documented.');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Acceptance')).toBeVisible();

    await page.getByRole('tab', { name: 'History' }).click();
    await expect(page.getByRole('tab', { name: 'History', selected: true })).toBeVisible();
    await page.getByRole('tab', { name: 'Comments' }).click();
    await expect(page.getByLabel('Add a comment')).toBeVisible();

    await expectThemed(page, theme);
    await expectNoSeriousViolations(page);
    await axeAndScreenshot(page, theme, '07-issue-detail');
  });
}

test('issue detail modal from board — edit summary, priority, comment, Escape', async ({
  page,
  request,
}) => {
  const { slug, key } = await bootstrapKanbanProject(page, request, 'detail-modal-flow', {
    projectName: 'Modal flow QA',
  });

  await page.goto(`/o/${slug}/p/${key}/issues`);
  await createIssueInDialog(page, 'Board modal flow', undefined, { expectDetailNav: true });

  await page.goto(`/o/${slug}/p/${key}/board`);
  await expect(page.getByRole('heading', { name: `${key} board` })).toBeVisible();

  await issueLink(page, `${key}-1`).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  await dialog.getByRole('button', { name: 'Edit summary' }).click();
  await dialog.getByRole('textbox', { name: 'Summary' }).fill('Updated from board modal');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.getByRole('heading', { name: 'Updated from board modal' })).toBeVisible();

  await dialog.getByRole('button', { name: /Priority: Medium\. Choose priority/i }).click();
  await page.getByRole('menuitem', { name: 'High', exact: true }).click();
  await expect(
    dialog.getByRole('button', { name: /Priority: High\. Choose priority/i }),
  ).toBeVisible();

  await dialog.getByLabel('Add a comment').fill('Verified on the board modal.');
  await dialog.getByRole('button', { name: 'Comment' }).click();
  await expect(dialog.getByText('Verified on the board modal.')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`/o/${slug}/p/${key}/board$`));
});

test('issue detail direct URL renders full page without modal shell', async ({ page, request }) => {
  const { slug, key } = await bootstrapKanbanProject(page, request, 'detail-page', {
    projectName: 'Page QA',
  });

  await page.goto(`/o/${slug}/p/${key}/issues`);
  await createIssueInDialog(page, 'Full page issue', undefined, { expectDetailNav: true });

  await page.goto(`/o/${slug}/issues/${key}-1`);
  await expect(page.getByRole('heading', { name: 'Full page issue' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close issue' })).toHaveCount(0);
});
