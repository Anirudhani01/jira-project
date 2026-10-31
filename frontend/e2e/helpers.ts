import AxeBuilder from '@axe-core/playwright';
import { expect, type APIRequestContext, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

export const MAILPIT = process.env.E2E_MAILPIT_URL ?? 'http://localhost:8025';
export const PASSWORD = 'Tr0ub4dour-Staple-Quartz-81!';
/** Used in journey 10 (must differ from signup password). */
export const NEW_E2E_PASSWORD = 'New-Passw0rd!-E2E-Change-99';

/** Repo-root `docs/ui-redesign/after/` (Playwright cwd is `frontend/`). */
export const UI_REDESIGN_AFTER_DIR = path.resolve(process.cwd(), '../docs/ui-redesign/after');

async function mailpitBodies(
  request: APIRequestContext,
  email: string,
): Promise<{ subject: string; text: string }[]> {
  const found = await request.get(
    `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
  );
  const summaries = (
    (await found.json()) as { messages: { ID: string; Subject: string; Created: string }[] }
  ).messages;
  const sorted = [...summaries].sort(
    (a, b) => new Date(b.Created).getTime() - new Date(a.Created).getTime(),
  );
  const bodies: { subject: string; text: string }[] = [];
  for (const summary of sorted) {
    const message = await request.get(`${MAILPIT}/api/v1/message/${summary.ID}`);
    const body = (await message.json()) as { Text: string; Subject: string };
    bodies.push({ subject: body.Subject ?? summary.Subject, text: body.Text });
  }
  return bodies;
}

export async function verificationLink(request: APIRequestContext, email: string): Promise<string> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    // Bodies are newest-first (Mailpit `Created`); first match is the latest verification mail.
    for (const { text } of await mailpitBodies(request, email)) {
      const match = /https?:\/\/\S+\/verify-email\S*/.exec(text);
      if (match) return match[0];
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`no verification email for ${email}`);
}

/** Token from the latest invitation email (worker must have processed the outbox). */
export async function invitationAcceptPath(
  request: APIRequestContext,
  email: string,
): Promise<string> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    // Newest invitation first (same ordering as integration `token_for`).
    for (const { subject, text } of await mailpitBodies(request, email)) {
      if (!subject.startsWith('Invitation')) continue;
      const match = /\/invitations\/accept#token=([A-Za-z0-9_-]+)/.exec(text);
      if (match) return `/invitations/accept#token=${match[1]}`;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`no invitation email for ${email}`);
}

export async function inviteToOrg(page: Page, orgSlug: string, email: string) {
  await page.goto(`/o/${orgSlug}/settings/members`);
  await page.getByLabel('Email to invite').fill(email);
  await page.getByRole('button', { name: 'Send invitation' }).click();
  await expect(page.getByText('Invitation sent.')).toBeVisible();
}

export async function acceptInvitation(
  page: Page,
  request: APIRequestContext,
  email: string,
  acceptPath?: string,
) {
  await page.goto(acceptPath ?? (await invitationAcceptPath(request, email)));
  await page.getByRole('button', { name: 'Accept invitation' }).click();
  await expect(page.getByRole('heading', { name: /Welcome to/i })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('link', { name: /^Open /i }).click();
}

export function localDateTimeInput(offsetHours: number) {
  const d = new Date(Date.now() + offsetHours * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Password fields share a show/hide toggle whose name includes "Password"; target the input only. */
export function passwordInput(page: Page, label = 'Password') {
  return page.getByRole('textbox', { name: label, exact: true });
}

/** Project keys must match backend `KEY_PATTERN` (`^[A-Z][A-Z0-9]{1,9}$`). */
export function e2eProjectKey(prefix: string): string {
  const alnum = `${prefix}${Date.now().toString(36)}`.replace(/[^a-z0-9]/gi, '').toUpperCase();
  const first = /[A-Z]/.exec(alnum)?.[0] ?? 'E';
  const rest = alnum.replace(/^[A-Z]/, '').slice(0, 4);
  return `${first}${rest.padEnd(2, 'X')}`.slice(0, 5);
}

/** Fresh slug/key/email triple for an isolated journey. */
export function e2eIdentity(prefix: string) {
  const suffix = `${prefix}-${Date.now().toString(36)}`;
  const email = `e2e-${suffix}@example.com`;
  const slug = `e2e${suffix.replace(/[^a-z0-9]/gi, '').slice(0, 26)}`.toLowerCase();
  const key = e2eProjectKey(prefix);
  return { suffix, email, slug, key };
}

/** Issue links include the summary in the accessible name — match by key substring. */
export function issueLink(page: Page, issueKey: string) {
  // Scoped to the page content: the sidebar's Recent list can link to the same issue.
  return page.locator('#main').getByRole('link', { name: issueKey, exact: true });
}

/** Project settings → Members card (avoids matching org-level “member” copy). */
export function projectMembersSection(page: Page) {
  return page.locator('section').filter({ has: page.locator('#project-members-title') });
}

export async function createOrganization(page: Page, slug: string, name: string) {
  await page.goto('/orgs/new');
  await page.getByLabel('Name').fill(name);
  await page.getByLabel('Address').fill(slug);
  await page.getByRole('button', { name: 'Create organization' }).click();
  await expect(page).toHaveURL(new RegExp(`/o/${slug}`));
}

export async function createProject(
  page: Page,
  orgSlug: string,
  projectKey: string,
  name: string,
  boardType: 'kanban' | 'scrum',
) {
  await page.goto(`/o/${orgSlug}/projects/new?board_type=${boardType}&step=create`);
  await page.getByLabel('Name').fill(name);
  await page.getByLabel('Key', { exact: true }).fill(projectKey);
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${projectKey}`));
}

/** Opens the profile menu and signs out (required before registering another user in the same browser). */
export async function signOut(page: Page, displayName = 'E2E User') {
  await page
    .getByRole('button', { name: new RegExp(`Open account menu for ${displayName}`, 'i') })
    .click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login/);
}

export async function loginAs(page: Page, email: string, displayName = 'E2E User') {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await passwordInput(page).fill(PASSWORD);
  await page.getByRole('button', { name: /sign in|log in/i }).click();
  await expect(
    page.getByRole('button', { name: new RegExp(`Open account menu for ${displayName}`, 'i') }),
  ).toBeVisible();
}

export async function signUpAndSignIn(
  page: Page,
  request: APIRequestContext,
  email: string,
  displayName = 'E2E User',
) {
  await page.goto('/signup');
  await page.getByLabel('Name').fill(displayName);
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
  await expect(
    page.getByRole('button', {
      name: new RegExp(`Open account menu for ${displayName}`, 'i'),
    }),
  ).toBeVisible();
}

export async function expectNoSeriousViolations(page: Page, excludeSelectors: string[] = []) {
  let builder = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']);
  for (const selector of excludeSelectors) {
    builder = builder.exclude(selector);
  }
  const results = await builder.analyze();
  const serious = results.violations.filter((v) =>
    ['serious', 'critical'].includes(v.impact ?? ''),
  );
  expect(
    serious.map((v) => `${v.id}: ${v.help} → ${v.nodes.map((n) => n.target.join(' ')).join('; ')}`),
  ).toEqual([]);
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
  const { email, slug, suffix } = e2eIdentity(tag);
  await signUpAndSignIn(page, request, email);
  await createOrganization(page, slug, `E2E ${suffix}`);
  return slug;
}

export async function sessionUserId(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const session = (await fetch('/api/v1/auth/session', { credentials: 'include' }).then((r) =>
      r.json(),
    )) as { user?: { id: string } };
    if (!session.user?.id) throw new Error('No signed-in session (expected user.id)');
    return session.user.id;
  });
}

/** Creates a project label (until create-issue UI is always pre-seeded). */
export async function createProjectLabelViaApi(
  page: Page,
  orgSlug: string,
  projectKey: string,
  name: string,
  color = '#336699',
): Promise<{ id: string }> {
  return page.evaluate(
    async ({ orgSlug, projectKey, name, color }) => {
      const session = (await fetch('/api/v1/auth/session', { credentials: 'include' }).then((r) =>
        r.json(),
      )) as { csrf_token?: string };
      if (!session.csrf_token) throw new Error('No CSRF token in session');
      const res = await fetch(`/api/v1/orgs/${orgSlug}/projects/${projectKey}/labels`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': session.csrf_token,
        },
        body: JSON.stringify({ name, color }),
      });
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      return (await res.json()) as { id: string };
    },
    { orgSlug, projectKey, name, color },
  );
}

/** Assign issue via API (triggers same notification path as the detail assignee menu). */
export async function assignIssueViaApi(
  page: Page,
  orgSlug: string,
  issueKey: string,
  assigneeId: string,
) {
  await page.evaluate(
    async ({ orgSlug, issueKey, assigneeId }) => {
      const session = (await fetch('/api/v1/auth/session', { credentials: 'include' }).then((r) =>
        r.json(),
      )) as { csrf_token?: string };
      if (!session.csrf_token) throw new Error('No CSRF token in session');
      const issue = (await fetch(`/api/v1/orgs/${orgSlug}/issues/${issueKey}`, {
        credentials: 'include',
      }).then((r) => r.json())) as { version: number };
      const res = await fetch(`/api/v1/orgs/${orgSlug}/issues/${issueKey}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': session.csrf_token,
          'If-Match': `"v${String(issue.version)}"`,
        },
        body: JSON.stringify({ assignee_id: assigneeId }),
      });
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
    },
    { orgSlug, issueKey, assigneeId },
  );
}

/** Adds a project member when the UI has no invite form (journey 4). */
export async function addProjectMemberViaApi(
  page: Page,
  orgSlug: string,
  projectKey: string,
  userId: string,
  role: 'admin' | 'member' | 'viewer' = 'member',
) {
  await page.evaluate(
    async ({ orgSlug, projectKey, userId, role }) => {
      const session = (await fetch('/api/v1/auth/session', { credentials: 'include' }).then((r) =>
        r.json(),
      )) as { csrf_token?: string };
      if (!session.csrf_token) throw new Error('No CSRF token in session');
      const res = await fetch(`/api/v1/orgs/${orgSlug}/projects/${projectKey}/members`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': session.csrf_token,
        },
        body: JSON.stringify({ user_id: userId, role }),
      });
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
    },
    { orgSlug, projectKey, userId, role },
  );
}

export async function createIssueInDialog(
  page: Page,
  summary: string,
  description?: string,
  { expectDetailNav = true }: { expectDetailNav?: boolean } = {},
) {
  await page.locator('#main').getByRole('button', { name: 'Create issue' }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Summary').fill(summary);
  if (description) {
    await dialog.getByLabel('Description').fill(description);
  }
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();
  if (expectDetailNav) {
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('heading', { name: summary })).toBeVisible({ timeout: 15_000 });
  }
}

export async function createIssueOnList(page: Page, summary: string, description?: string) {
  await createIssueInDialog(page, summary, description);
}

/** Sign up, create org + Kanban project; returns slugs for navigation. */
export async function bootstrapKanbanProject(
  page: Page,
  request: APIRequestContext,
  tag: string,
  options: { orgName?: string; projectName?: string } = {},
) {
  const id = e2eIdentity(tag);
  await signUpAndSignIn(page, request, id.email);
  await createOrganization(page, id.slug, options.orgName ?? `E2E ${id.suffix}`);
  await createProject(page, id.slug, id.key, options.projectName ?? 'QA project', 'kanban');
  return id;
}

export async function expectThemed(page: Page, theme: 'light' | 'dark') {
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
}

export async function axeAndScreenshot(
  page: Page,
  theme: 'light' | 'dark',
  screenshotBasename: string,
  options?: { axeExclude?: string[] },
) {
  await expectNoSeriousViolations(page, options?.axeExclude);
  await captureAfterScreenshot(page, screenshotBasename, theme);
}
