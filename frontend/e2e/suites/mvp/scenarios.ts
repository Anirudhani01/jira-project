import { expect, test } from '@playwright/test';

import {
  acceptInvitation,
  addProjectMemberViaApi,
  createIssueOnList,
  createOrganization,
  createProject,
  createProjectLabelViaApi,
  e2eIdentity,
  expectNoSeriousViolations,
  inviteToOrg,
  issueLink,
  projectMembersSection,
  localDateTimeInput,
  loginAs,
  NEW_E2E_PASSWORD,
  PASSWORD,
  passwordInput,
  sessionUserId,
  signOut,
  signUpAndSignIn,
} from '../../helpers';

import type { MvpScenario } from './types';

export const mvpScenarios: MvpScenario[] = [
  {
    planJourney: '01',
    id: '01-signup-org',
    smoke: true,
    title: 'sign up, verify email, create org, empty project list',
    run: async ({ page, request }) => {
      const { email, slug, suffix } = e2eIdentity('j1');
      await signUpAndSignIn(page, request, email);
      await createOrganization(page, slug, `E2E Org ${suffix}`);
      await page.goto(`/o/${slug}`);
      await expect(page.getByRole('heading', { name: `E2E Org ${suffix}` })).toBeVisible();
      await expect(page.getByText('No projects yet')).toBeVisible();
      await expect(page.getByRole('link', { name: 'Create project' })).toBeVisible();
      await expectNoSeriousViolations(page);
    },
  },
  {
    planJourney: '02',
    id: '02-invitation',
    title: 'invite teammate by email and accept into org',
    run: async ({ page, request }) => {
      const owner = e2eIdentity('j2-owner');
      const invitee = e2eIdentity('j2-invitee');
      await signUpAndSignIn(page, request, owner.email);
      await createOrganization(page, owner.slug, `Invite Org ${owner.suffix}`);
      await inviteToOrg(page, owner.slug, invitee.email);
      await signOut(page);
      await signUpAndSignIn(page, request, invitee.email);
      await acceptInvitation(page, request, invitee.email);
      await expect(page).toHaveURL(new RegExp(`/o/${owner.slug}`));
      await expect(page.getByRole('heading', { name: `Invite Org ${owner.suffix}` })).toBeVisible();
      await expectNoSeriousViolations(page);
    },
  },
  {
    planJourney: '03',
    id: '03-kanban',
    title: 'create Kanban project with board and settings',
    run: async ({ page, request }) => {
      const { email, slug, key, suffix } = e2eIdentity('j3-k');
      await signUpAndSignIn(page, request, email);
      await createOrganization(page, slug, `Kanban ${suffix}`);
      await createProject(page, slug, key, 'Website', 'kanban');
      await page.goto(`/o/${slug}/p/${key}/board`);
      await expect(page.getByRole('heading', { name: `${key} board` })).toBeVisible();
      await page.goto(`/o/${slug}/p/${key}`);
      await expect(page.getByRole('heading', { name: `${key} — Website` })).toBeVisible();
      await expectNoSeriousViolations(page);
    },
  },
  {
    planJourney: '03',
    id: '03-scrum',
    title: 'create Scrum project with backlog and board',
    run: async ({ page, request }) => {
      const { email, slug, key, suffix } = e2eIdentity('j3-s');
      await signUpAndSignIn(page, request, email);
      await createOrganization(page, slug, `Scrum ${suffix}`);
      await createProject(page, slug, key, 'Mobile app', 'scrum');
      await page.goto(`/o/${slug}/p/${key}/backlog`);
      await expect(page.getByRole('heading', { name: `${key} backlog` })).toBeVisible();
      await page.goto(`/o/${slug}/p/${key}/board`);
      await expect(page.getByRole('heading', { name: `${key} board` })).toBeVisible();
      await expectNoSeriousViolations(page);
    },
  },
  {
    planJourney: '04',
    id: '04-project-members',
    title: 'add project member (API) and list on project settings',
    run: async ({ page, request }) => {
      const owner = e2eIdentity('j4-owner');
      const member = e2eIdentity('j4-member');
      await signUpAndSignIn(page, request, owner.email);
      await createOrganization(page, owner.slug, `Members ${owner.suffix}`);
      await createProject(page, owner.slug, owner.key, 'Shared', 'kanban');
      await inviteToOrg(page, owner.slug, member.email);
      await signOut(page);
      await signUpAndSignIn(page, request, member.email);
      await acceptInvitation(page, request, member.email);
      const memberUserId = await sessionUserId(page);
      await signOut(page);
      await loginAs(page, owner.email);
      await addProjectMemberViaApi(page, owner.slug, owner.key, memberUserId, 'member');
      await page.goto(`/o/${owner.slug}/p/${owner.key}`);
      const members = projectMembersSection(page);
      const memberRow = members.locator('li').filter({ hasText: member.email });
      await expect(memberRow).toBeVisible();
      await expect(memberRow.getByText('member', { exact: true })).toBeVisible();
      await expectNoSeriousViolations(page);
    },
  },
  {
    planJourney: '05',
    id: '05-create-full',
    title: 'create issue with type, priority, assignee, and key',
    run: async ({ page, request }) => {
      const { email, slug, key, suffix } = e2eIdentity('j5');
      await signUpAndSignIn(page, request, email);
      await createOrganization(page, slug, `Issues ${suffix}`);
      await createProject(page, slug, key, 'Product', 'kanban');
      await page.goto(`/o/${slug}/p/${key}/issues`);
      await page.locator('#main').getByRole('button', { name: 'Create issue' }).first().click();
      const dialog = page.getByRole('dialog');
      await dialog.getByLabel('Summary').fill('Checkout fails on Safari');
      await dialog.getByLabel('Description').fill('Steps to reproduce in staging.');
      await dialog.getByLabel('Priority').selectOption({ label: 'High' });
      await dialog.getByLabel('Type').selectOption({ label: 'Bug' });
      await dialog.getByLabel('Assignee').selectOption({ label: 'E2E User' });
      await dialog.getByRole('button', { name: 'Create', exact: true }).click();
      const issueKey = `${key}-1`;
      await expect(page.getByRole('heading', { name: 'Checkout fails on Safari' })).toBeVisible();
      await page.goto(`/o/${slug}/p/${key}/issues`);
      await expect(issueLink(page, issueKey)).toBeVisible();
      await expectNoSeriousViolations(page);
    },
  },
  {
    planJourney: '05',
    id: '05-create-shortcut',
    title: 'create issue from list dialog shortcut',
    run: async ({ page, request }) => {
      const { email, slug, key } = e2eIdentity('j5b');
      await signUpAndSignIn(page, request, email);
      await createOrganization(page, slug, 'Quick');
      await createProject(page, slug, key, 'Ops', 'kanban');
      await page.goto(`/o/${slug}/p/${key}/issues`);
      await createIssueOnList(page, 'Rotate logs weekly');
      await page.goto(`/o/${slug}/p/${key}/issues`);
      await expect(issueLink(page, `${key}-1`)).toBeVisible();
      await expectNoSeriousViolations(page);
    },
  },
  {
    planJourney: '05',
    id: '05-subtask-labels',
    title: 'parent issue, sub-task, and project label on parent',
    run: async ({ page, request }) => {
      const { email, slug, key } = e2eIdentity('j5-h');
      await signUpAndSignIn(page, request, email);
      await createOrganization(page, slug, 'Hierarchy');
      await createProject(page, slug, key, 'Tree', 'kanban');
      await page.goto(`/o/${slug}/p/${key}/issues`);
      await createIssueOnList(page, 'Parent story');
      const parentKey = `${key}-1`;
      await createProjectLabelViaApi(page, slug, key, 'qa-label', '#cc3355');
      await page.reload();
      await page.getByRole('button', { name: 'Edit labels' }).click();
      await page.locator('label').filter({ hasText: 'qa-label' }).getByRole('checkbox').check();
      await page.getByRole('button', { name: 'Save' }).click();
      await expect(page.getByText('qa-label')).toBeVisible();
      await page.goto(`/o/${slug}/p/${key}/issues`);
      await page.locator('#main').getByRole('button', { name: 'Create issue' }).first().click();
      const dialog = page.getByRole('dialog');
      await dialog.getByLabel('Type').selectOption({ label: 'Sub-task' });
      await dialog.getByLabel('Summary').fill('Child sub-task');
      await dialog.getByLabel('Parent (required for a sub-task)').fill(parentKey);
      await dialog.getByRole('button', { name: 'Create', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Child sub-task' })).toBeVisible();
      await expect(page.getByRole('link', { name: new RegExp(parentKey, 'i') })).toBeVisible();
      await expectNoSeriousViolations(page);
    },
  },
  {
    planJourney: '06',
    id: '06-issue-detail',
    title: 'view and edit issue, assign, transition, comment, activity',
    run: async ({ page, request }) => {
      const { email, slug, key } = e2eIdentity('j6');
      await signUpAndSignIn(page, request, email);
      await createOrganization(page, slug, 'Detail');
      await createProject(page, slug, key, 'App', 'kanban');
      await page.goto(`/o/${slug}/p/${key}/issues`);
      await createIssueOnList(page, 'Original summary', 'Initial description');
      await page.getByRole('button', { name: 'Edit summary' }).click();
      await page.getByRole('textbox', { name: 'Summary' }).fill('Updated summary');
      await page.getByRole('button', { name: 'Save' }).click();
      await expect(page.getByRole('heading', { name: 'Updated summary' })).toBeVisible();
      await page.getByRole('button', { name: /Assignee: Unassigned/ }).click();
      await page.getByRole('menuitem', { name: 'E2E User' }).click();
      await expect(page.getByRole('button', { name: /Assignee: E2E User/ })).toBeVisible();
      await page.getByRole('button', { name: /Status:/ }).click();
      await page.getByRole('menuitem', { name: /^In Progress,/ }).click();
      await expect(page.getByRole('button', { name: /Status: In Progress/ })).toBeVisible();
      await page.getByLabel('Add a comment').fill('Shipped to staging for QA.');
      await page.getByRole('button', { name: 'Comment' }).click();
      await expect(page.getByText('Shipped to staging for QA.')).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Activity' })).toBeVisible();
      await expectNoSeriousViolations(page);
    },
  },
  {
    planJourney: '07',
    id: '07-kanban-board',
    smoke: true,
    title: 'Kanban column transition, keyboard drag, board filter',
    run: async ({ page, request }) => {
      const { email, slug, key } = e2eIdentity('j7');
      await signUpAndSignIn(page, request, email);
      await createOrganization(page, slug, 'Board');
      await createProject(page, slug, key, 'Flow', 'kanban');
      await page.goto(`/o/${slug}/p/${key}/issues`);
      await createIssueOnList(page, 'First card');
      await page.goto(`/o/${slug}/p/${key}/issues`);
      await createIssueOnList(page, 'Second card');
      await page.goto(`/o/${slug}/p/${key}/board`);
      const todo = page.getByRole('region', { name: /To Do/i });
      await expect(todo.getByRole('link', { name: new RegExp(`${key}-1`, 'i') })).toBeVisible();
      await expect(todo.getByRole('link', { name: new RegExp(`${key}-2`, 'i') })).toBeVisible();
      await page.getByRole('button', { name: `More actions for ${key}-1` }).click();
      await page.getByRole('menuitem', { name: 'In Progress', exact: true }).click();
      const progress = page.getByRole('region', { name: /In Progress/i });
      await expect(issueLink(page, `${key}-1`)).toBeVisible();
      await expect(todo.getByRole('link', { name: new RegExp(`${key}-1`, 'i') })).toHaveCount(0);
      await page.getByRole('button', { name: `More actions for ${key}-2` }).click();
      await page.getByRole('menuitem', { name: 'In Progress', exact: true }).click();
      await expect(issueLink(page, `${key}-2`)).toBeVisible();
      await expect(todo.getByRole('link', { name: new RegExp(`${key}-2`, 'i') })).toHaveCount(0);
      await page.getByRole('searchbox', { name: 'Filter board' }).fill(`${key}-2`);
      await expect(progress.getByRole('link', { name: new RegExp(`${key}-1`, 'i') })).toHaveCount(
        0,
      );
      await expect(progress.getByRole('link', { name: new RegExp(`${key}-2`, 'i') })).toBeVisible();
      await page.getByRole('button', { name: 'Clear' }).click();
      await expect(progress.getByRole('link', { name: new RegExp(`${key}-1`, 'i') })).toBeVisible();
      await expectNoSeriousViolations(page);
    },
  },
  {
    planJourney: '08',
    id: '08-scrum-sprint',
    title: 'Scrum backlog, sprint start, board, complete sprint',
    run: async ({ page, request }) => {
      const { email, slug, key } = e2eIdentity('j8');
      await signUpAndSignIn(page, request, email);
      await createOrganization(page, slug, 'Scrum');
      await createProject(page, slug, key, 'Sprints', 'scrum');
      await page.goto(`/o/${slug}/p/${key}/issues`);
      await createIssueOnList(page, 'Backlog story');
      await page.goto(`/o/${slug}/p/${key}/backlog`);
      await page.getByPlaceholder('New sprint name').fill('Sprint Alpha');
      await page.getByRole('button', { name: 'Create sprint' }).click();
      await expect(page.getByRole('heading', { name: /Sprint Alpha/ })).toBeVisible();
      const issueKey = `${key}-1`;
      await page.getByLabel(`Move ${issueKey} to`).selectOption({ label: 'Sprint Alpha' });
      await page.getByRole('button', { name: 'Start sprint' }).click();
      await page.locator('input[type="datetime-local"]').nth(0).fill(localDateTimeInput(-1));
      await page.locator('input[type="datetime-local"]').nth(1).fill(localDateTimeInput(48));
      await page.getByRole('button', { name: 'Start', exact: true }).click();
      await expect(
        page.getByRole('region', { name: 'Sprint Alpha' }).getByText('Active'),
      ).toBeVisible();
      await page.goto(`/o/${slug}/p/${key}/board`);
      await expect(issueLink(page, issueKey)).toBeVisible();
      await page.goto(`/o/${slug}/p/${key}/backlog`);
      await page.getByRole('button', { name: 'Complete sprint' }).click();
      await expect(page.getByRole('heading', { name: 'Backlog', exact: true })).toBeVisible();
      await expectNoSeriousViolations(page);
    },
  },
  {
    planJourney: '09',
    id: '09-search-notify',
    title: 'search issue list and in-app assignment notification',
    run: async ({ browser, request }) => {
      test.setTimeout(180_000);
      const owner = e2eIdentity('j9-owner');
      const assignee = e2eIdentity('j9-assignee');
      const ownerContext = await browser.newContext();
      const assigneeContext = await browser.newContext();
      const ownerPage = await ownerContext.newPage();
      const assigneePage = await assigneeContext.newPage();
      try {
        await signUpAndSignIn(ownerPage, request, owner.email, 'Owner User');
        await createOrganization(ownerPage, owner.slug, `Notify ${owner.suffix}`);
        await createProject(ownerPage, owner.slug, owner.key, 'Alerts', 'kanban');
        await inviteToOrg(ownerPage, owner.slug, assignee.email);
        await signOut(ownerPage, 'Owner User');
        await signUpAndSignIn(assigneePage, request, assignee.email, 'Assignee User');
        await acceptInvitation(assigneePage, request, assignee.email);
        const assigneeId = await sessionUserId(assigneePage);
        await loginAs(ownerPage, owner.email, 'Owner User');
        await addProjectMemberViaApi(ownerPage, owner.slug, owner.key, assigneeId, 'member');
        await ownerPage.goto(`/o/${owner.slug}/p/${owner.key}`);
        await expect(
          projectMembersSection(ownerPage).locator('li').filter({ hasText: assignee.email }),
        ).toBeVisible();
        await ownerPage.goto(`/o/${owner.slug}/p/${owner.key}/issues`);
        await createIssueOnList(ownerPage, 'Notification target', 'Find me with search');
        await ownerPage.goto(`/o/${owner.slug}/p/${owner.key}/issues`);
        await ownerPage.getByRole('searchbox', { name: 'Search issues' }).fill('notification');
        await ownerPage
          .locator('#main')
          .getByRole('button', { name: 'Search', exact: true })
          .click();
        await expect(issueLink(ownerPage, `${owner.key}-1`)).toBeVisible();
        const issueKey = `${owner.key}-1`;
        await ownerPage.goto(`/o/${owner.slug}/issues/${issueKey}`);
        await ownerPage.reload();
        await ownerPage.getByRole('button', { name: /Assignee: Unassigned/ }).click();
        const assigneeItem = ownerPage.getByRole('menuitem').filter({ hasText: 'Assignee User' });
        await expect(assigneeItem).toBeVisible({ timeout: 15_000 });
        await assigneeItem.click();
        await expect(
          ownerPage.getByRole('button', { name: /Assignee: Assignee User/ }),
        ).toBeVisible();
        await assigneePage.goto(`/o/${owner.slug}/p/${owner.key}/issues`);
        await expect
          .poll(
            async () => {
              const res = await assigneePage.request.get(
                `/api/v1/orgs/${owner.slug}/notifications/unread-count`,
              );
              if (!res.ok()) return 0;
              return (await res.json()).count as number;
            },
            { timeout: 45_000, intervals: [500, 1000, 2000] },
          )
          .toBeGreaterThan(0);
        await assigneePage.getByRole('button', { name: 'Notifications' }).click();
        await expect(
          assigneePage.getByRole('link', { name: new RegExp(`assigned you ${issueKey}`, 'i') }),
        ).toBeVisible();
        await expectNoSeriousViolations(ownerPage);
      } finally {
        await ownerContext.close();
        await assigneeContext.close();
      }
    },
  },
  {
    planJourney: '10',
    id: '10-audit-account',
    title: 'audit log, change password, active sessions, revoke other session',
    run: async ({ page, request, browser }) => {
      const { email, slug, key, suffix } = e2eIdentity('j10');
      await signUpAndSignIn(page, request, email);
      await createOrganization(page, slug, `Audit ${suffix}`);
      await createProject(page, slug, key, 'Trail', 'kanban');
      await page.goto(`/o/${slug}/p/${key}/issues`);
      await createIssueOnList(page, 'Audited change');
      await page.goto(`/o/${slug}/settings/audit`);
      await expect(page.getByRole('heading', { name: 'Audit log' })).toBeVisible();
      await expect(
        page
          .locator('#main')
          .getByText(/project\.|issue\./)
          .first(),
      ).toBeVisible({
        timeout: 10_000,
      });
      await page.goto('/account');
      await expect(page.getByRole('heading', { name: 'Active sessions' })).toBeVisible();
      await expect(page.getByText('(this device)')).toBeVisible();

      const otherContext = await browser.newContext();
      const otherPage = await otherContext.newPage();
      try {
        await loginAs(otherPage, email);
        await page.goto('/account');
        await page.getByRole('button', { name: 'Sign out all other sessions' }).click();
        await otherPage.goto(`/o/${slug}`);
        await expect(otherPage).toHaveURL(/\/login/);
      } finally {
        await otherContext.close();
      }

      await page.getByLabel('Current password').fill(PASSWORD);
      await page.getByLabel('New password').fill(NEW_E2E_PASSWORD);
      await page.getByLabel('Confirm new password').fill(NEW_E2E_PASSWORD);
      await page.getByRole('button', { name: 'Change password' }).click();
      await expect(page.getByText('Password changed.')).toBeVisible();
      await page.goto('/login');
      await page.getByLabel('Email').fill(email);
      await passwordInput(page).fill(NEW_E2E_PASSWORD);
      await page.getByRole('button', { name: /sign in|log in/i }).click();
      await expect(page.getByRole('button', { name: /E2E User/i })).toBeVisible();
      await expectNoSeriousViolations(page);
    },
  },
];
