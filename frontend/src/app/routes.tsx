import type { RouteObject } from 'react-router';

import { AccountPage } from '../features/account/AccountPage';
import { ForgotPasswordPage } from '../features/auth/pages/ForgotPasswordPage';
import { LoginPage } from '../features/auth/pages/LoginPage';
import { ResetPasswordPage } from '../features/auth/pages/ResetPasswordPage';
import { SignupPage } from '../features/auth/pages/SignupPage';
import { VerifyEmailPage } from '../features/auth/pages/VerifyEmailPage';
import { RequireAuth } from '../features/auth/RequireAuth';
import { CreateOrgPage } from '../features/orgs/pages/CreateOrgPage';
import { CreateProjectPage } from '../features/projects/CreateProjectPage';
import { IssueDetailPage } from '../features/issues/IssueDetailPage';
import { DesignPage } from './DesignPage';
import { AuditPage } from '../features/audit/AuditPage';
import { BacklogPage } from '../features/backlog/BacklogPage';
import { BoardPage } from '../features/board/BoardPage';
import { IssueListPage } from '../features/issues/IssueListPage';
import { ProjectPage } from '../features/projects/ProjectPage';
import { AcceptInvitationPage } from '../features/orgs/pages/AcceptInvitationPage';
import { OrgHomePage } from '../features/orgs/pages/OrgHomePage';
import { OrgMembersPage } from '../features/orgs/pages/OrgMembersPage';
import { OrgSettingsPage } from '../features/orgs/pages/OrgSettingsPage';

import { AppShell } from './AppShell';
import { HomePage } from './pages/HomePage';
import { NotFoundPage } from './pages/NotFoundPage';
import { RouteErrorBoundary } from './RouteErrorBoundary';

/** Child routes rendered under `/` (used by `MainOutlet` for modal background matching). */
export const appShellChildRoutes: RouteObject[] = [
  { index: true, element: <HomePage /> },
  // Component gallery for visual QA; never part of a production build.
  ...(import.meta.env.DEV ? [{ path: '__design', element: <DesignPage /> }] : []),
  { path: 'login', element: <LoginPage /> },
  { path: 'signup', element: <SignupPage /> },
  { path: 'verify-email', element: <VerifyEmailPage /> },
  { path: 'forgot-password', element: <ForgotPasswordPage /> },
  { path: 'reset-password', element: <ResetPasswordPage /> },
  { path: 'invitations/accept', element: <AcceptInvitationPage /> },
  {
    element: <RequireAuth />,
    children: [
      { path: 'account', element: <AccountPage /> },
      { path: 'orgs/new', element: <CreateOrgPage /> },
      { path: 'o/:org', element: <OrgHomePage /> },
      { path: 'o/:org/settings', element: <OrgSettingsPage /> },
      { path: 'o/:org/settings/members', element: <OrgMembersPage /> },
      { path: 'o/:org/settings/audit', element: <AuditPage /> },
      { path: 'o/:org/projects/new', element: <CreateProjectPage /> },
      { path: 'o/:org/p/:key', element: <ProjectPage /> },
      { path: 'o/:org/p/:key/issues', element: <IssueListPage /> },
      { path: 'o/:org/p/:key/board', element: <BoardPage /> },
      { path: 'o/:org/p/:key/backlog', element: <BacklogPage /> },
      { path: 'o/:org/issues/:issueKey', element: <IssueDetailPage /> },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
];

export const routes: RouteObject[] = [
  {
    path: '/',
    element: <AppShell />,
    errorElement: <RouteErrorBoundary />,
    children: appShellChildRoutes,
  },
];
