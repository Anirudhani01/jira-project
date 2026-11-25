/**
 * Responsive + visual QA sweep (full stack, demo data).
 *
 * Visits every page in light / paper / dark at phone, tablet and desktop widths and records,
 * for each combination: horizontal page overflow, serious/critical axe violations and a
 * screenshot. Every combination is reported (soft assertions); a small `<page>.json` result is
 * written next to each screenshot (`.tmp/visual-qa/<viewport>/<theme>/`).
 *
 * Needs the demo data (`make seed-demo`: org `demo`, projects MOBILE and SHOP) and a running
 * stack. Run: `E2E_BASE_URL=http://127.0.0.1:5173 make e2e-visual-qa`.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const ORG = process.env.E2E_DEMO_ORG ?? 'demo';
const EMAIL = process.env.E2E_DEMO_EMAIL ?? 'demo@gmail.com';
// Local demo account created by `make seed-demo` (same value as app/scripts/seed_demo.py).
const PASSWORD = process.env.E2E_DEMO_PASSWORD ?? 'Winter2026!Mob'; // gitleaks:allow local demo only
const OUT_DIR = process.env.E2E_SCREENSHOTS ?? path.resolve(process.cwd(), '../.tmp/visual-qa');

const THEMES = ['light', 'paper', 'dark'] as const;
const VIEWPORTS = {
  phone: { width: 375, height: 720 },
  tablet: { width: 768, height: 1024 },
  desktop: { width: 1440, height: 900 },
} as const;

interface QaPage {
  id: string;
  path: string;
}

/** Pages that work without signing in. */
const PUBLIC_PAGES: QaPage[] = [
  { id: 'login', path: '/login' },
  { id: 'signup', path: '/signup' },
  { id: 'forgot-password', path: '/forgot-password' },
  { id: 'not-found', path: '/no-such-page' },
];

/** Pages behind the sign-in. */
const APP_PAGES: QaPage[] = [
  { id: 'org-home', path: `/o/${ORG}` },
  { id: 'org-settings', path: `/o/${ORG}/settings` },
  { id: 'org-members', path: `/o/${ORG}/settings/members` },
  { id: 'org-audit', path: `/o/${ORG}/settings/audit` },
  { id: 'admin-overview', path: `/o/${ORG}/admin` },
  { id: 'admin-general', path: `/o/${ORG}/admin/general` },
  { id: 'admin-members', path: `/o/${ORG}/admin/members` },
  { id: 'admin-invitations', path: `/o/${ORG}/admin/invitations` },
  { id: 'admin-catalogs', path: `/o/${ORG}/admin/catalogs` },
  { id: 'admin-audit', path: `/o/${ORG}/admin/audit` },
  { id: 'admin-auth-activity', path: `/o/${ORG}/admin/security/activity` },
  { id: 'admin-workflow', path: `/o/${ORG}/admin/workflow` },
  { id: 'admin-notifications', path: `/o/${ORG}/admin/system/notifications` },
  { id: 'admin-email', path: `/o/${ORG}/admin/system/email` },
  { id: 'project-overview', path: `/o/${ORG}/p/MOBILE` },
  { id: 'project-summary', path: `/o/${ORG}/p/MOBILE/summary` },
  { id: 'project-summary-kanban', path: `/o/${ORG}/p/SHOP/summary` },
  { id: 'issues', path: `/o/${ORG}/p/MOBILE/issues` },
  { id: 'board-scrum', path: `/o/${ORG}/p/MOBILE/board` },
  { id: 'board-kanban', path: `/o/${ORG}/p/SHOP/board` },
  { id: 'backlog', path: `/o/${ORG}/p/MOBILE/backlog` },
  { id: 'issue-detail', path: `/o/${ORG}/issues/MOBILE-1` },
  { id: 'create-project', path: `/o/${ORG}/projects/new` },
  { id: 'create-org', path: '/orgs/new' },
  { id: 'account', path: '/account' },
];

/** Optional filter: E2E_QA_PAGES=project-summary,issues runs only those pages. */
const ONLY = process.env.E2E_QA_PAGES?.split(',')
  .map((id) => id.trim())
  .filter(Boolean);
const selected = (pages: QaPage[]) =>
  ONLY ? pages.filter((page) => ONLY.includes(page.id)) : pages;

interface Cell {
  viewport: string;
  theme: string;
  page: string;
  url: string;
  overflowPx: number;
  overflowing: string[];
  themeApplied: boolean;
  axe: string[];
  error?: string;
}

const cellDir = (viewport: string, theme: string) => path.join(OUT_DIR, viewport, theme);

async function settle(page: Page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => undefined);
  // Skeletons and fonts: give the first paint a moment.
  await page.waitForTimeout(400);
}

async function measure(page: Page) {
  return page.evaluate(() => {
    const width = window.innerWidth;
    const root = document.documentElement;
    const overflowPx = Math.max(0, root.scrollWidth - width);
    const offenders: string[] = [];
    if (overflowPx > 1) {
      for (const el of Array.from(document.body.querySelectorAll('*'))) {
        const box = el.getBoundingClientRect();
        if (box.width > 0 && box.right > width + 1 && offenders.length < 4) {
          const cls = typeof el.className === 'string' ? el.className.split(' ')[0] : '';
          offenders.push(
            `${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''} (right ${String(Math.round(box.right))}px)`,
          );
        }
      }
    }
    return { overflowPx, offenders };
  });
}

async function check(page: Page, viewport: string, theme: string, qa: QaPage) {
  const cell: Cell = {
    viewport,
    theme,
    page: qa.id,
    url: qa.path,
    overflowPx: 0,
    overflowing: [],
    themeApplied: false,
    axe: [],
  };
  try {
    await page.goto(qa.path);
    await settle(page);
    cell.themeApplied = (await page.locator('html').getAttribute('data-theme')) === theme;
    const { overflowPx, offenders } = await measure(page);
    cell.overflowPx = overflowPx;
    cell.overflowing = offenders;
    const result = await new AxeBuilder({ page }).analyze();
    cell.axe = result.violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => `${v.id} x${String(v.nodes.length)}`);
    fs.mkdirSync(cellDir(viewport, theme), { recursive: true });
    await page.screenshot({ path: path.join(cellDir(viewport, theme), `${qa.id}.png`) });
  } catch (error) {
    cell.error = error instanceof Error ? error.message.split('\n')[0] : String(error);
  }
  // One result file per combination: a worker restart after a failure cannot lose earlier ones.
  fs.mkdirSync(cellDir(viewport, theme), { recursive: true });
  fs.writeFileSync(path.join(cellDir(viewport, theme), `${qa.id}.json`), JSON.stringify(cell));
  const label = `${viewport}/${theme}/${qa.id}`;
  expect.soft(cell.error, `${label}: page failed to load`).toBeUndefined();
  expect.soft(cell.themeApplied, `${label}: theme applied`).toBe(true);
  expect
    .soft(cell.overflowPx, `${label}: horizontal overflow ${cell.overflowing.join('; ')}`)
    .toBeLessThanOrEqual(1);
  expect.soft(cell.axe, `${label}: serious accessibility violations`).toEqual([]);
}

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(EMAIL);
  await page.getByLabel(/^password/i).fill(PASSWORD);
  await page.getByRole('button', { name: /sign in|log in/i }).click();
  await page.waitForURL(/\/o\//, { timeout: 20_000 });
}

for (const [viewportName, size] of Object.entries(VIEWPORTS)) {
  for (const theme of THEMES) {
    test.describe(`${viewportName} · ${theme}`, () => {
      test.use({
        viewport: size,
        ...(viewportName === 'phone' ? { isMobile: true, hasTouch: true } : {}),
      });

      test.beforeEach(async ({ page }) => {
        await page.addInitScript((value) => {
          localStorage.setItem('theme', value);
        }, theme);
      });

      test('public pages', async ({ page }) => {
        test.setTimeout(5 * 60_000);
        for (const qa of selected(PUBLIC_PAGES)) await check(page, viewportName, theme, qa);
      });

      test('signed-in pages', async ({ page }) => {
        test.setTimeout(15 * 60_000);
        await signIn(page);
        for (const qa of selected(APP_PAGES)) await check(page, viewportName, theme, qa);
      });
    });
  }
}
