import type { RouteObject } from 'react-router';

import { AccountPage } from '../features/account/AccountPage';
import { ForgotPasswordPage } from '../features/auth/pages/ForgotPasswordPage';
import { LoginPage } from '../features/auth/pages/LoginPage';
import { ResetPasswordPage } from '../features/auth/pages/ResetPasswordPage';
import { SignupPage } from '../features/auth/pages/SignupPage';
import { VerifyEmailPage } from '../features/auth/pages/VerifyEmailPage';
import { RequireAuth } from '../features/auth/RequireAuth';
import { CreateOrgPage } from '../features/orgs/pages/CreateOrgPage';
import { OrgHomePage } from '../features/orgs/pages/OrgHomePage';
import { OrgSettingsPage } from '../features/orgs/pages/OrgSettingsPage';

import { AppShell } from './AppShell';
import { HomePage } from './pages/HomePage';
import { NotFoundPage } from './pages/NotFoundPage';
import { RouteErrorBoundary } from './RouteErrorBoundary';

export const routes: RouteObject[] = [
  {
    path: '/',
    element: <AppShell />,
    errorElement: <RouteErrorBoundary />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'login', element: <LoginPage /> },
      { path: 'signup', element: <SignupPage /> },
      { path: 'verify-email', element: <VerifyEmailPage /> },
      { path: 'forgot-password', element: <ForgotPasswordPage /> },
      { path: 'reset-password', element: <ResetPasswordPage /> },
      {
        element: <RequireAuth />,
        children: [
          { path: 'account', element: <AccountPage /> },
          { path: 'orgs/new', element: <CreateOrgPage /> },
          { path: 'o/:org', element: <OrgHomePage /> },
          { path: 'o/:org/settings', element: <OrgSettingsPage /> },
        ],
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];
