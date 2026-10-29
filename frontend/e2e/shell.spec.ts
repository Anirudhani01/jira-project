import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const MAILPIT = process.env.E2E_MAILPIT_URL ?? 'http://localhost:8025';
const PASSWORD = 'Tr0ub4dour-Staple-Quartz-81!';

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
  await expect(page.getByRole('button', { name: /E2E User/i })).toBeVisible();
}

test('project sidebar: keyboard navigation Board → Backlog → Issues', async ({ page, request }) => {
  const suffix = Date.now().toString(36);
  const email = `shell-${suffix}@example.com`;
  const slug = `sh${suffix}`.slice(0, 30);
  const key = `S${suffix
    .replace(/[^a-z]/g, '')
    .toUpperCase()
    .padEnd(2, 'X')
    .slice(0, 4)}`;

  await signUpAndSignIn(page, request, email);

  await page.goto('/orgs/new');
  await page.getByLabel('Name').fill(`Shell ${suffix}`);
  await page.getByLabel('Address').fill(slug);
  await page.getByRole('button', { name: 'Create organization' }).click();

  await page.goto(`/o/${slug}/projects/new`);
  await page.getByLabel('Name').fill('Scrum app');
  await page.getByLabel('Key').fill(key);
  await page.getByLabel('Board type').selectOption('scrum');
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.goto(`/o/${slug}/p/${key}/board`);

  const projectNav = page.getByRole('navigation', { name: 'Project' });
  await expect(projectNav).toBeVisible();

  await projectNav.getByRole('link', { name: 'Backlog' }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/p/${key}/backlog`));

  await projectNav.getByRole('link', { name: 'Issues' }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/p/${key}/issues`));

  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  const serious = results.violations.filter((v) =>
    ['serious', 'critical'].includes(v.impact ?? ''),
  );
  expect(serious.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
});
