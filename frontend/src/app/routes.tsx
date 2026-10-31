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
import { BacklogPage } from '../features/backlog/BacklogPage';
import { BoardPage } from '../features/board/BoardPage';
import { IssueListPage } from '../features/issues/IssueListPage';
import { ProjectPage } from '../features/projects/ProjectPage';
import { AcceptInvitationPage } from '../features/orgs/pages/AcceptInvitationPage';
import { OrgHomePage } from '../features/orgs/pages/OrgHomePage';
import { orgAdminChildRoutes } from '../features/admin/adminRoutes';

import { AppShell } from './AppShell';
import { OnlineStatusProvider } from './OnlineStatusProvider';
import { SessionExpiryProvider } from './SessionExpiryProvider';
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
      {
        path: 'o/:org',
        children: [
          { index: true, element: <OrgHomePage /> },
          orgAdminChildRoutes,
          { path: 'projects/new', element: <CreateProjectPage /> },
          { path: 'p/:key', element: <ProjectPage /> },
          { path: 'p/:key/issues', element: <IssueListPage /> },
          { path: 'p/:key/board', element: <BoardPage /> },
          { path: 'p/:key/backlog', element: <BacklogPage /> },
          { path: 'issues/:issueKey', element: <IssueDetailPage /> },
        ],
      },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
];

export const routes: RouteObject[] = [
  {
    path: '/',
    element: (
      <OnlineStatusProvider>
        <SessionExpiryProvider>
          <AppShell />
        </SessionExpiryProvider>
      </OnlineStatusProvider>
    ),
    errorElement: <RouteErrorBoundary />,
    children: appShellChildRoutes,
  },
];
