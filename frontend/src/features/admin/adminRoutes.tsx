import type { RouteObject } from 'react-router';

import { AuditPage } from '../audit/AuditPage';
import { AuthenticationActivityPage } from '../authActivity/AuthenticationActivityPage';
import { OrgMembersPage } from '../orgs/pages/OrgMembersPage';
import { OrgSettingsPage } from '../orgs/pages/OrgSettingsPage';

import { AdminCatalogsPage } from './pages/AdminCatalogsPage';
import { AdminOverviewPage } from './pages/AdminOverviewPage';
import { AdminWorkflowHubPage } from './pages/AdminWorkflowHubPage';
import { AdminSystemEmailPage } from './pages/AdminSystemEmailPage';
import { AdminSystemNotificationsPage } from './pages/AdminSystemNotificationsPage';
import { AdminShellLayout } from './AdminShellLayout';

/** Canonical and legacy Administration routes under `/o/:org` (shared AdminShellLayout). */
export const orgAdminChildRoutes: RouteObject = {
  element: <AdminShellLayout />,
  children: [
    { path: 'admin', element: <AdminOverviewPage /> },
    { path: 'admin/general', element: <OrgSettingsPage /> },
    { path: 'admin/members', element: <OrgMembersPage /> },
    {
      path: 'admin/invitations',
      element: <OrgMembersPage initialSection="invitations" />,
    },
    { path: 'admin/catalogs', element: <AdminCatalogsPage /> },
    { path: 'admin/audit', element: <AuditPage /> },
    { path: 'admin/security/activity', element: <AuthenticationActivityPage /> },
    { path: 'admin/workflow', element: <AdminWorkflowHubPage /> },
    { path: 'admin/system/notifications', element: <AdminSystemNotificationsPage /> },
    { path: 'admin/system/email', element: <AdminSystemEmailPage /> },
    { path: 'settings', element: <OrgSettingsPage /> },
    { path: 'settings/members', element: <OrgMembersPage /> },
    { path: 'settings/audit', element: <AuditPage /> },
  ],
};
