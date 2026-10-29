import AxeBuilder from '@axe-core/playwright';
import { expect, type APIRequestContext, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

export const MAILPIT = process.env.E2E_MAILPIT_URL ?? 'http://localhost:8025';
export const PASSWORD = 'Tr0ub4dour-Staple-Quartz-81!';

/** Repo-root `docs/ui-redesign/after/` (Playwright cwd is `frontend/`). */
export const UI_REDESIGN_AFTER_DIR = path.resolve(process.cwd(), '../docs/ui-redesign/after');

export async function verificationLink(request: APIRequestContext, email: string): Promise<string> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const found = await request.get(
      `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
    );
    const messages = ((await found.json()) as { messages: { ID: string }[] }).messages;
    if (messages[0]) {
      const message = await request.get(`${MAILPIT}/api/v1/message/${messages[0].ID}`);
      const text = ((await message.json()) as { Text: string }).Text;
      const match = /https?:\/\/\S+\/verify-email\S*/.exec(text);
      if (match) return match[0];
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`no verification email for ${email}`);
}

/** Password fields share a show/hide toggle whose name includes "Password"; target the input only. */
export function passwordInput(page: Page, label = 'Password') {
  return page.getByRole('textbox', { name: label, exact: true });
}

export async function signUpAndSignIn(page: Page, request: APIRequestContext, email: string) {
  await page.goto('/signup');
  await page.getByLabel('Name').fill('E2E User');
  await page.getByLabel('Email').fill(email);
  await passwordInput(page).fill(PASSWORD);
  await page.getByRole('button', { name: /sign up|create account/i }).click();
  await expect(page.getByText(/check your email/i)).toBeVisible();
  await page.goto(await verificationLink(request, email));
  await page.getByRole('button', { name: /verify/i }).click();
  await expect(page.getByText(/verified/i).first()).toBeVisible();
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await passwordInput(page).fill(PASSWORD);
  await page.getByRole('button', { name: /sign in|log in/i }).click();
  await expect(page.getByRole('button', { name: /E2E User/i })).toBeVisible();
}

export async function expectNoSeriousViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  const serious = results.violations.filter((v) =>
    ['serious', 'critical'].includes(v.impact ?? ''),
  );
  expect(serious.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
}

export async function setTheme(page: Page, theme: 'light' | 'dark') {
  await page.addInitScript((value) => {
    localStorage.setItem('theme', value);
  }, theme);
}

export async function captureAfterScreenshot(
  page: Page,
  basename: string,
  theme: 'light' | 'dark',
) {
  const dir = process.env.E2E_SCREENSHOTS ?? UI_REDESIGN_AFTER_DIR;
  fs.mkdirSync(dir, { recursive: true });
  await page.screenshot({
    path: path.join(dir, `${basename}-${theme}.png`),
    fullPage: true,
  });
}

/** Signed-in user with a fresh org (for org home / project / account routes). */
export async function signUpAndCreateOrg(
  page: Page,
  request: APIRequestContext,
  tag: string,
): Promise<string> {
  const suffix = `${tag}-${Date.now().toString(36)}`;
  const email = `e2e-${suffix}@example.com`;
  const slug = `e2e${suffix.replace(/[^a-z0-9]/gi, '').slice(0, 26)}`.toLowerCase();
  await signUpAndSignIn(page, request, email);
  await page.goto('/orgs/new');
  await page.getByLabel('Name').fill(`E2E ${suffix}`);
  await page.getByLabel('Address').fill(slug);
  await page.getByRole('button', { name: 'Create organization' }).click();
  await expect(page).toHaveURL(new RegExp(`/o/${slug}`));
  return slug;
}

export async function expectThemed(page: Page, theme: 'light' | 'dark') {
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
}

export async function axeAndScreenshot(
  page: Page,
  theme: 'light' | 'dark',
  screenshotBasename: string,
) {
  await expectNoSeriousViolations(page);
  await captureAfterScreenshot(page, screenshotBasename, theme);
}
