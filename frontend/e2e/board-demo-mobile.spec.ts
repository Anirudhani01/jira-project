import { expect, test } from '@playwright/test';
import path from 'node:path';

import { passwordInput } from './helpers';

const DEMO_EMAIL = 'demo@gmail.com';
const DEMO_PASSWORD = 'Winter2026!Mob';
const BOARD_PATH = '/o/demo/p/MOBILE/board';

async function loginDemo(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill(DEMO_EMAIL);
  await passwordInput(page).fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/o\//, { timeout: 30_000 });
}

test.describe('demo MOBILE scrum board (M5 regression)', () => {
  test('loads four columns, filters, and board chrome', async ({ page }) => {
    await loginDemo(page);
    await page.setViewportSize({ width: 1544, height: 968 });
    await page.goto(BOARD_PATH);
    await expect(page.getByRole('heading', { name: 'MOBILE board' })).toBeVisible();
    await expect(page.getByRole('combobox', { name: /search issues and projects/i })).toBeVisible();
    for (const name of ['To Do', 'In Progress', 'In Review', 'Done']) {
      await expect(page.getByRole('region', { name: new RegExp(`^${name}$`, 'i') })).toBeVisible();
    }
    await expect(page.getByRole('searchbox', { name: 'Filter board' })).toBeVisible();
    // Demo seed creates six MOBILE issues (MOBILE-1 … MOBILE-6); filter regression uses the last key.
    await page.getByRole('searchbox', { name: 'Filter board' }).fill('MOBILE-6');
    await expect(page.getByRole('link', { name: 'MOBILE-6' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'MOBILE-7' })).toHaveCount(0);
  });

  test('layout at desktop and mobile viewports', async ({ page }) => {
    await loginDemo(page);
    for (const [width, height] of [
      [1544, 968],
      [1366, 768],
      [1024, 768],
      [390, 844],
    ] as const) {
      await page.setViewportSize({ width, height });
      await page.goto(BOARD_PATH);
      await expect(page.getByRole('heading', { name: 'MOBILE board' })).toBeVisible();
      await expect(page.getByRole('region', { name: /To Do/i })).toBeVisible();
      if (width === 1024) {
        const wrap = page.locator('.board-columns-wrap');
        await expect(wrap).toBeVisible();
        const scrolls = await wrap.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
        expect(scrolls, 'tablet uses in-board horizontal scroll').toBe(true);
      } else {
        const docOverflow = await page.evaluate(() => {
          const doc = document.documentElement;
          const prevScroll = doc.scrollLeft;
          doc.scrollLeft = 9999;
          const canScrollPage = doc.scrollLeft > 0;
          doc.scrollLeft = prevScroll;
          return canScrollPage;
        });
        expect(docOverflow, `page overflow at ${String(width)}×${String(height)}`).toBe(false);
      }
    }
  });

  test('captures reference viewport screenshot when E2E_SCREENSHOTS is set', async ({ page }) => {
    test.skip(!process.env.E2E_SCREENSHOTS, 'Set E2E_SCREENSHOTS to capture board screenshots');
    await loginDemo(page);
    await page.setViewportSize({ width: 1544, height: 968 });
    await page.goto(BOARD_PATH);
    await expect(page.getByRole('heading', { name: 'MOBILE board' })).toBeVisible();
    await page.getByRole('region', { name: /In Progress/i }).waitFor();
    const outDir = process.env.E2E_SCREENSHOTS ?? path.resolve(process.cwd(), '../docs');
    await page.screenshot({
      path: path.join(outDir, 'mobile-scrum-board-m5-1544x968.png'),
      fullPage: false,
    });
  });
});
