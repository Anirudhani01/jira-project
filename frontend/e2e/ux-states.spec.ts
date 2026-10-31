/**
 * Global UX state regression suite (M6).
 * Isolation: fresh org/project per test; workers=1; no shared mutable state; no arbitrary sleeps.
 */
import { expect, test } from '@playwright/test';

import {
  acceptInvitation,
  addProjectMemberViaApi,
  bootstrapKanbanProject,
  createIssueInDialog,
  e2eIdentity,
  inviteToOrg,
  loginAs,
  PASSWORD,
  passwordInput,
  setTheme,
  signOut,
  signUpAndSignIn,
} from './helpers';
import {
  expectSessionExpiredDialogOnce,
  holdFirstCreateIssuePost,
  routeApi401ExceptAuth,
  triggerSessionExpiryViaReload,
} from './ux-helpers';

test('UX-T1: light theme on bootstrap board', async ({ page, request }) => {
  await setTheme(page, 'light');
  const { slug, key } = await bootstrapKanbanProject(page, request, 'ux-theme-light');
  await page.goto(`/o/${slug}/p/${key}/board`);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.getByRole('heading', { name: new RegExp(`${key} board`, 'i') })).toBeVisible();
});

test('UX-R1: offline banner without reload', async ({ page, request, context }) => {
  const { slug, key } = await bootstrapKanbanProject(page, request, 'ux-offline');
  await page.goto(`/o/${slug}/p/${key}/issues`);
  await expect(page.getByRole('heading', { name: new RegExp(`${key}`, 'i') })).toBeVisible();
  await context.setOffline(true);
  await expect(page.getByText(/You appear to be offline/i)).toBeVisible();
  await context.setOffline(false);
  await expect(page.getByText(/You appear to be offline/i)).toHaveCount(0);
});

test('UX-R2: mobile issue list search empty', async ({ page, request }) => {
  const { slug, key } = await bootstrapKanbanProject(page, request, 'ux-search-empty');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/o/${slug}/p/${key}/issues?q=__no_match_ux_e2e__`);
  await expect(page.getByRole('heading', { name: /No issues for/i })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Clear search' })).toBeVisible();
});

test('UX-D1: issue field draft restore after reload', async ({ page, request }) => {
  const { slug, key } = await bootstrapKanbanProject(page, request, 'ux-draft');
  await page.goto(`/o/${slug}/p/${key}/issues`);
  await createIssueInDialog(page, 'Draft restore target', undefined, { expectDetailNav: true });
  const issueKey = `${key.toUpperCase()}-1`;
  const draftValue = 'Restored summary from stored draft';
  await page.evaluate(
    ({ org, issueKey, value }) => {
      sessionStorage.setItem(
        'ux:issue-field-drafts:v1',
        JSON.stringify([
          {
            v: 1,
            org,
            issueKey,
            field: 'summary',
            value,
            baseVersion: 1,
            capturedAt: new Date().toISOString(),
          },
        ]),
      );
    },
    { org: slug, issueKey, value: draftValue },
  );
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Unsaved edits from before sign-in' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Restore draft' }).click();
  await expect(page.getByRole('textbox', { name: 'Summary' })).toHaveValue(draftValue);
});

test('UX-M1: create issue single POST and pending submit', async ({ page, request }) => {
  const { slug, key } = await bootstrapKanbanProject(page, request, 'ux-dup-create');
  await page.goto(`/o/${slug}/p/${key}/issues`);
  const hold = await holdFirstCreateIssuePost(page);
  await page.locator('#main').getByRole('button', { name: 'Create issue' }).first().click();
  const dialog = page.getByRole('dialog');
  const summary = 'Single create UX-M1 issue';
  await dialog.getByLabel('Summary').fill(summary);
  const createBtn = dialog.getByRole('button', { name: 'Create', exact: true });
  await createBtn.click();
  await expect(createBtn).toBeDisabled();
  await expect(createBtn).toHaveAttribute('aria-busy', 'true');
  expect(hold.getPostCount()).toBe(1);
  hold.release();
  await expect(page.getByRole('heading', { name: summary })).toBeVisible({ timeout: 15_000 });
  expect(hold.getPostCount()).toBe(1);
});

test('UX-S1: concurrent 401 responses show one session-expired dialog', async ({
  page,
  request,
}) => {
  const { slug, key } = await bootstrapKanbanProject(page, request, 'ux-multi-401');
  await page.goto(`/o/${slug}/p/${key}/issues`);
  await expect(
    page.getByRole('button', { name: new RegExp('Open account menu', 'i') }),
  ).toBeVisible();
  await routeApi401ExceptAuth(page);
  await triggerSessionExpiryViaReload(page);
  await expectSessionExpiredDialogOnce(page);
  await expect(page.getByRole('dialog', { name: 'Session expired' })).toHaveCount(1);
});

test('UX-S2: safeNext round-trip after session expiry', async ({ page, request }) => {
  const id = e2eIdentity('ux-safenext');
  await signUpAndSignIn(page, request, id.email);
  await page.goto('/orgs/new');
  await page.getByLabel('Name').fill(`Org ${id.suffix}`);
  await page.getByLabel('Address').fill(id.slug);
  await page.getByRole('button', { name: 'Create organization' }).click();
  await expect(page).toHaveURL(new RegExp(`/o/${id.slug}`));
  await page.goto(`/o/${id.slug}/projects/new?board_type=kanban&step=create`);
  await page.getByLabel('Name').fill('SafeNext project');
  await page.getByLabel('Key').fill(id.key);
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${id.key}`));

  const deepPath = `/o/${id.slug}/p/${id.key}/issues?q=uxsafenext`;
  await page.goto(deepPath);
  await expect(
    page.getByRole('button', { name: new RegExp('Open account menu', 'i') }),
  ).toBeVisible();

  await routeApi401ExceptAuth(page);
  await triggerSessionExpiryViaReload(page);
  const dialog = await expectSessionExpiredDialogOnce(page);
  await dialog.getByRole('button', { name: 'Continue to sign in' }).click();
  await expect(page).toHaveURL(/\/login\?next=/);
  const next = new URL(page.url()).searchParams.get('next');
  expect(next).toContain('/issues?q=uxsafenext');
  await page.unroute('**/api/v1/**');
  const loginPath = `/login?next=${encodeURIComponent(next ?? '')}`;
  await page.goto(loginPath);
  const signInHeading = page.getByRole('heading', { name: 'Sign in to your workspace' });
  if (!(await signInHeading.isVisible())) {
    await signOut(page);
    await page.goto(loginPath);
    await expect(signInHeading).toBeVisible();
  }
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill(id.email);
  await passwordInput(page).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(
    page.getByRole('button', { name: new RegExp('Open account menu', 'i') }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(page).toHaveURL(new RegExp(`/o/${id.slug}/p/${id.key}/issues`));
  expect(page.url()).toContain('q=uxsafenext');
});

test('UX-K1: session expired dialog primary action is keyboard reachable', async ({
  page,
  request,
}) => {
  const { slug, key } = await bootstrapKanbanProject(page, request, 'ux-keyboard-session');
  await page.goto(`/o/${slug}/p/${key}/issues`);
  await routeApi401ExceptAuth(page);
  await triggerSessionExpiryViaReload(page);
  const dialog = await expectSessionExpiredDialogOnce(page);
  const signIn = dialog.getByRole('button', { name: 'Continue to sign in' });
  await signIn.focus();
  await expect(signIn).toBeFocused();
});

test('UX-P1: org member cannot view audit log', async ({ page, request }) => {
  const owner = e2eIdentity('ux-audit-owner');
  const member = e2eIdentity('ux-audit-member');
  await signUpAndSignIn(page, request, owner.email, 'Owner User');
  await page.goto('/orgs/new');
  await page.getByLabel('Name').fill(`Org ${owner.suffix}`);
  await page.getByLabel('Address').fill(owner.slug);
  await page.getByRole('button', { name: 'Create organization' }).click();
  await inviteToOrg(page, owner.slug, member.email);
  await signOut(page, 'Owner User');
  await signUpAndSignIn(page, request, member.email);
  await acceptInvitation(page, request, member.email);
  await page.goto(`/o/${owner.slug}/settings/audit`);
  await expect(page.getByText(/owners and admins/i)).toBeVisible();
});

test('UX-P2: project viewer has no create issue on board', async ({ page, request }) => {
  const owner = e2eIdentity('ux-viewer-owner');
  const viewer = e2eIdentity('ux-viewer-user');
  await signUpAndSignIn(page, request, owner.email, 'Owner User');
  await page.goto('/orgs/new');
  await page.getByLabel('Name').fill(`Org ${owner.suffix}`);
  await page.getByLabel('Address').fill(owner.slug);
  await page.getByRole('button', { name: 'Create organization' }).click();
  await page.goto(`/o/${owner.slug}/projects/new?board_type=kanban&step=create`);
  await page.getByLabel('Name').fill('Viewer project');
  await page.getByLabel('Key').fill(owner.key);
  await page.getByRole('button', { name: 'Create project' }).click();
  await inviteToOrg(page, owner.slug, viewer.email);
  await signOut(page, 'Owner User');
  await signUpAndSignIn(page, request, viewer.email);
  await acceptInvitation(page, request, viewer.email);
  const viewerId = await page.evaluate(async () => {
    const session = (await fetch('/api/v1/auth/session', { credentials: 'include' }).then((r) =>
      r.json(),
    )) as { user?: { id: string } };
    if (!session.user?.id) throw new Error('no session');
    return session.user.id;
  });
  await signOut(page);
  await loginAs(page, owner.email, 'Owner User');
  await addProjectMemberViaApi(page, owner.slug, owner.key, viewerId, 'viewer');
  await signOut(page, 'Owner User');
  await loginAs(page, viewer.email);
  await page.goto(`/o/${owner.slug}/p/${owner.key}/board`);
  await expect(
    page.getByRole('heading', { name: new RegExp(`${owner.key} board`, 'i') }),
  ).toBeVisible();
  await expect(page.locator('#main').getByRole('button', { name: 'Create issue' })).toHaveCount(0);
});

test('UX-M2: org invite submit disables while pending', async ({ page, request }) => {
  const id = e2eIdentity('ux-invite-dup');
  await signUpAndSignIn(page, request, id.email);
  await page.goto('/orgs/new');
  await page.getByLabel('Name').fill(`Org ${id.suffix}`);
  await page.getByLabel('Address').fill(id.slug);
  await page.getByRole('button', { name: 'Create organization' }).click();

  let releaseInvite: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    releaseInvite = resolve;
  });
  await page.route('**/api/v1/orgs/*/invitations', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    await gate;
    await route.continue();
  });

  await page.goto(`/o/${id.slug}/settings/members`);
  await page.getByLabel('Email to invite').fill(`pending-${id.email}`);
  const send = page.getByRole('button', { name: 'Send invitation' });
  await send.click();
  await expect(send).toBeDisabled();
  await expect(send).toHaveAttribute('aria-busy', 'true');
  releaseInvite?.();
  await expect(page.getByText('Invitation sent.')).toBeVisible();
});
