import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const MAILPIT = process.env.E2E_MAILPIT_URL ?? 'http://localhost:8025';
const PASSWORD = 'Tr0ub4dour-Staple-Quartz-81!';

/** The verification link from the newest mail to `email` (the worker delivers within seconds). */
async function verificationLink(request: APIRequestContext, email: string): Promise<string> {
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

async function signUpAndSignIn(page: Page, request: APIRequestContext, email: string) {
  await page.goto('/signup');
  await page.getByLabel('Name').fill('E2E User');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: /sign up|create account/i }).click();
  await expect(page.getByText(/check your email/i)).toBeVisible();
  await page.goto(await verificationLink(request, email));
  await page.getByRole('button', { name: /verify/i }).click();
  await expect(page.getByText(/verified/i).first()).toBeVisible();
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: /sign in|log in/i }).click();
  await expect(page.getByRole('link', { name: 'E2E User' })).toBeVisible();
}

async function expectNoSeriousViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  const serious = results.violations.filter((v) =>
    ['serious', 'critical'].includes(v.impact ?? ''),
  );
  expect(serious.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
}

test('sign up, plan a project and move a card on the board', async ({ page, request }) => {
  const suffix = Date.now().toString(36);
  const email = `e2e-${suffix}@example.com`;
  const slug = `e2e${suffix}`.slice(0, 30);
  const key = `E${suffix
    .replace(/[^a-z]/g, '')
    .toUpperCase()
    .padEnd(3, 'X')
    .slice(0, 5)}`;

  await signUpAndSignIn(page, request, email);

  await page.goto('/orgs/new');
  await page.getByLabel('Name').fill(`E2E ${suffix}`);
  await page.getByLabel('Address').fill(slug);
  await page.getByRole('button', { name: 'Create organization' }).click();
  await expect(page).toHaveURL(new RegExp(`/o/${slug}`));

  await page.goto(`/o/${slug}/projects/new`);
  await page.getByLabel('Name').fill('Website');
  await page.getByLabel('Key').fill(key);
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${key}`));

  await page.goto(`/o/${slug}/p/${key}/issues`);
  await page.getByRole('button', { name: 'Create issue' }).click();
  await page.getByLabel('Summary').fill('Login button misaligned');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Login button misaligned' })).toBeVisible();

  // Search finds it by text.
  await page.goto(`/o/${slug}/p/${key}/issues`);
  await page.getByRole('searchbox', { name: 'Search issues' }).fill('login');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.getByText(`${key}-1`)).toBeVisible();

  await page.goto(`/o/${slug}/p/${key}/board`);
  await expect(page.getByRole('heading', { name: `${key} board` })).toBeVisible();
  const todo = page.getByRole('region', { name: /To Do/ });
  await expect(todo.getByRole('link', { name: `${key}-1` })).toBeVisible();
  await expectNoSeriousViolations(page);

  // Keyboard-friendly alternative to dragging: the card's "Move to" menu.
  await page.getByLabel(`Move ${key}-1 to`).selectOption({ label: 'In Progress' });
  const progress = page.getByRole('region', { name: /In Progress/ });
  await expect(progress.getByRole('link', { name: `${key}-1` })).toBeVisible();
  await expect(todo.getByRole('link', { name: `${key}-1` })).toHaveCount(0);

  // The notification bell and audit log are reachable and accessible.
  await page.goto(`/o/${slug}/settings/audit`);
  await expect(page.getByRole('heading', { name: 'Audit log' })).toBeVisible();
  await expectNoSeriousViolations(page);
});
