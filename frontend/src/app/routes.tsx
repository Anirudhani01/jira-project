import type { RouteObject } from 'react-router';

import { AccountPage } from '../features/account/AccountPage';
import { LoginPage } from '../features/auth/pages/LoginPage';
import { SignupPage } from '../features/auth/pages/SignupPage';
import { RequireAuth } from '../features/auth/RequireAuth';

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
      {
        element: <RequireAuth />,
        children: [{ path: 'account', element: <AccountPage /> }],
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];
