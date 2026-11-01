import { expect, test } from '@playwright/test';

import {
  A4A_ORG_SLUG,
  A4A_PROJECT_KEY,
  STATUS_TODO,
  createA4aMockContext,
  installA4aMockRouter,
} from './a4a-fixtures';
import { expectNoSeriousViolations } from './helpers';

const viewports = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'desktop', width: 1280, height: 800 },
] as const;

for (const viewport of viewports) {
  test(`workflow edit journey (${viewport.name})`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const ctx = createA4aMockContext();
    await installA4aMockRouter(page, ctx);

    await page.goto(`/o/${A4A_ORG_SLUG}/p/${A4A_PROJECT_KEY}?tab=workflow`);
    await page.getByLabel('Workflow name').fill('Team workflow');
    await page.getByLabel('WIP limit').first().fill('4');
    await page.getByRole('button', { name: 'Save workflow' }).click();
    await expect.poll(() => ctx.telemetry.workflowPutBodies.length).toBe(1);
    await expect(page.getByRole('button', { name: 'Save workflow' })).toBeDisabled();

    const body = ctx.telemetry.workflowPutBodies[0] as {
      name: string;
      columns: { wip_limit: number | null }[];
    };
    expect(body.name).toBe('Team workflow');
    expect(body.columns[0]?.wip_limit).toBe(4);

    await expectNoSeriousViolations(page);

    await page.getByRole('button', { name: 'Delete status Done' }).click();
    await expect(page.getByRole('button', { name: 'Remove from draft' })).toBeVisible();
    await page.screenshot({
      path: `test-results/workflow-edit-delete-dialog-${viewport.name}.png`,
      fullPage: true,
    });
    await page.getByRole('button', { name: 'Cancel' }).click();

    await page.screenshot({
      path: `test-results/workflow-edit-${viewport.name}.png`,
      fullPage: true,
    });
  });
}

test('workflow edit — 412 keeps draft', async ({ page }) => {
  const ctx = createA4aMockContext();
  await installA4aMockRouter(page, ctx, {
    workflowPut: async ({ fulfill, attempt }) => {
      if (attempt === 1) {
        await fulfill(412, {
          type: 'urn:problem:conflict',
          title: 'Conflict',
          status: 412,
          code: 'workflow_revision_conflict',
          detail: 'Workflow revision conflict.',
        });
        return 'handled';
      }
      return 'fallthrough';
    },
  });

  await page.goto(`/o/${A4A_ORG_SLUG}/p/${A4A_PROJECT_KEY}?tab=workflow`);
  await expect(page.getByLabel('Workflow name')).toBeVisible();
  await page.getByLabel('Workflow name').fill('Conflict draft');
  await page.getByRole('button', { name: 'Save workflow' }).click();
  await expect(page.getByText(/Someone else updated this workflow/)).toBeVisible();
  await expect(page.getByLabel('Workflow name')).toHaveValue('Conflict draft');
});

test('workflow edit — status_in_use remap resubmit', async ({ page }) => {
  const ctx = createA4aMockContext();
  await installA4aMockRouter(page, ctx, {
    workflowPut: async ({ fulfill, body, attempt }) => {
      const remaps = (body as { status_remaps?: unknown[] }).status_remaps ?? [];
      if (attempt === 1 && remaps.length === 0) {
        await fulfill(422, {
          type: 'urn:problem:validation',
          title: 'Validation',
          status: 422,
          code: 'status_in_use',
          detail: 'Provide status_remaps for statuses that still have issues.',
        });
        return 'handled';
      }
      return 'fallthrough';
    },
  });

  await page.goto(`/o/${A4A_ORG_SLUG}/p/${A4A_PROJECT_KEY}?tab=workflow`);
  await expect(page.getByLabel('Workflow name')).toBeVisible();
  await page.getByRole('button', { name: 'Delete status Done' }).click();
  await page.getByRole('button', { name: 'Remove from draft' }).click();
  await page.getByRole('button', { name: 'Save workflow' }).click();
  await expect(page.getByText(/Issues still use a removed status/)).toBeVisible();
  await page.screenshot({ path: 'test-results/workflow-edit-status-in-use.png', fullPage: true });
  await page.getByLabel(/Replacement status for/).selectOption(STATUS_TODO);
  await expect(page.getByRole('button', { name: 'Save workflow' })).toBeEnabled();
  await page.getByRole('button', { name: 'Apply remapping to draft' }).click();
  await page.getByRole('button', { name: 'Save workflow' }).click();
  await expect.poll(() => ctx.telemetry.workflowPutBodies.length).toBe(2);
});
