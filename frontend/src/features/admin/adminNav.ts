import type { LucideIcon } from 'lucide-react';
import {
  ArrowLeft,
  Bell,
  ClipboardList,
  Columns3,
  GitBranch,
  LayoutDashboard,
  Mail,
  ScrollText,
  Settings2,
  UserPlus,
  Users,
} from 'lucide-react';

export type AdminNavItem = {
  id: string;
  label: string;
  to: string;
  icon: LucideIcon;
  /** Hide unless caller has org audit permission. */
  requiresAudit?: boolean;
  /** Hide unless caller can manage org (owner/admin). */
  requiresManage?: boolean;
};

export type AdminNavGroup = {
  id: string;
  label: string;
  items: AdminNavItem[];
};

export function adminNavGroups(orgSlug: string): AdminNavGroup[] {
  const base = `/o/${orgSlug}/admin`;
  return [
    {
      id: 'overview',
      label: 'Overview',
      items: [{ id: 'overview', label: 'Overview', to: base, icon: LayoutDashboard }],
    },
    {
      id: 'organization',
      label: 'Organization',
      items: [
        { id: 'general', label: 'General', to: `${base}/general`, icon: Settings2 },
        {
          id: 'catalogs',
          label: 'Defaults & Catalogs',
          to: `${base}/catalogs`,
          icon: ClipboardList,
        },
      ],
    },
    {
      id: 'people',
      label: 'People & Access',
      items: [
        { id: 'members', label: 'Members', to: `${base}/members`, icon: Users },
        { id: 'invitations', label: 'Invitations', to: `${base}/invitations`, icon: UserPlus },
      ],
    },
    {
      id: 'security',
      label: 'Security',
      items: [
        {
          id: 'audit',
          label: 'Audit Logs',
          to: `${base}/audit`,
          icon: ScrollText,
          requiresAudit: true,
        },
      ],
    },
    {
      id: 'workflow',
      label: 'Workflow',
      items: [
        {
          id: 'workflow-types',
          label: 'Issue Types & Priorities',
          to: `${base}/catalogs`,
          icon: ClipboardList,
        },
        { id: 'workflow', label: 'Workflows', to: `${base}/workflow`, icon: GitBranch },
        { id: 'boards', label: 'Boards', to: `${base}/workflow#boards`, icon: Columns3 },
      ],
    },
    {
      id: 'system',
      label: 'System',
      items: [
        {
          id: 'notifications',
          label: 'Notifications',
          to: `${base}/system/notifications`,
          icon: Bell,
          requiresManage: true,
        },
        {
          id: 'email',
          label: 'Email Delivery',
          to: `${base}/system/email`,
          icon: Mail,
          requiresManage: true,
        },
      ],
    },
  ];
}

export function filterAdminNavGroups(
  groups: AdminNavGroup[],
  permissions: string[],
): AdminNavGroup[] {
  const canAudit = permissions.includes('org.audit.view');
  const canManage = permissions.includes('org.manage');
  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        if (item.requiresAudit && !canAudit) return false;
        if (item.requiresManage && !canManage) return false;
        return true;
      }),
    }))
    .filter((group) => group.items.length > 0);
}

export function adminBackToWorkspace(orgSlug: string) {
  return { to: `/o/${orgSlug}`, label: 'Back to workspace', icon: ArrowLeft };
}

/** Breadcrumb segment for the current admin path (last segment only). */
export function adminBreadcrumbLabel(pathname: string, orgSlug: string): string {
  const prefix = `/o/${orgSlug}/`;
  const rest = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : pathname;
  if (rest === 'settings') return 'General';
  if (rest === 'settings/members') return 'Members';
  if (rest === 'settings/audit') return 'Audit Logs';
  if (rest === 'admin' || rest === 'admin/') return 'Overview';
  const map: Record<string, string> = {
    'admin/general': 'General',
    'admin/members': 'Members',
    'admin/invitations': 'Invitations',
    'admin/catalogs': 'Defaults & Catalogs',
    'admin/audit': 'Audit Logs',
    'admin/workflow': 'Workflows',
    'admin/system/notifications': 'Notifications',
    'admin/system/email': 'Email Delivery',
  };
  return map[rest] ?? 'Administration';
}
