import type { RouteObject } from 'react-router';

import { AuditPage } from '../audit/AuditPage';
import { OrgMembersPage } from '../orgs/pages/OrgMembersPage';
import { OrgSettingsPage } from '../orgs/pages/OrgSettingsPage';

import { AdminPlaceholderPage } from './AdminPlaceholderPage';
import { AdminShellLayout } from './AdminShellLayout';

/** Canonical and legacy Administration routes under `/o/:org` (shared AdminShellLayout). */
export const orgAdminChildRoutes: RouteObject = {
  element: <AdminShellLayout />,
  children: [
    {
      path: 'admin',
      element: (
        <AdminPlaceholderPage
          title="Administration overview"
          description="Manage organization settings, people, security, workflow defaults, and system preferences from one place."
        />
      ),
    },
    { path: 'admin/general', element: <OrgSettingsPage /> },
    { path: 'admin/members', element: <OrgMembersPage /> },
    {
      path: 'admin/invitations',
      element: <OrgMembersPage initialSection="invitations" />,
    },
    {
      path: 'admin/catalogs',
      element: (
        <AdminPlaceholderPage
          title="Defaults & catalogs"
          description="Organization-wide issue types and priorities. Editing arrives in a later administration slice."
        />
      ),
    },
    { path: 'admin/audit', element: <AuditPage /> },
    {
      path: 'admin/workflow',
      element: (
        <AdminPlaceholderPage
          title="Workflows"
          description="Workflow and board configuration is project-specific today. Use this hub to jump to project settings."
        />
      ),
    },
    {
      path: 'admin/system/notifications',
      element: (
        <AdminPlaceholderPage
          title="Notifications"
          description="In-app notifications are available to users. Organization-wide notification policies are not configurable yet."
        />
      ),
    },
    {
      path: 'admin/system/email',
      element: (
        <AdminPlaceholderPage
          title="Email delivery"
          description="Outbound email is managed by the platform. SMTP and delivery credentials are not exposed in the product."
        />
      ),
    },
    { path: 'settings', element: <OrgSettingsPage /> },
    { path: 'settings/members', element: <OrgMembersPage /> },
    { path: 'settings/audit', element: <AuditPage /> },
  ],
};
