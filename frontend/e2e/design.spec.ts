import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

// The component gallery is a dev-only route (`pnpm dev`), so this runs with `make e2e`.
for (const theme of ['light', 'dark'] as const) {
  test(`design system gallery is accessible in ${theme} mode`, async ({ page }) => {
    await page.addInitScript((value) => {
      localStorage.setItem('theme', value);
    }, theme);
    await page.goto('/__design');
    await expect(page.getByRole('heading', { name: 'Design system' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    const found = results.violations.map(
      (v) => `${v.id} (${v.impact ?? '?'}): ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
    );
    expect(found).toEqual([]);
    if (process.env.E2E_SCREENSHOTS) {
      await page.screenshot({
        path: `${process.env.E2E_SCREENSHOTS}/design-${theme}.png`,
        fullPage: true,
      });
    }
  });
}
