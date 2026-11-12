import { useMatch } from 'react-router';

import { useAdminShell } from './useAdminShell';
import { useShowProjectSidebar } from './useProjectContext';

/** Org slug from `/o/:org/...` when the user is inside an organization (with or without a project). */
export function useOrgSlug(): string | null {
  const match = useMatch('/o/:org/*');
  return match?.params.org ?? null;
}

/** Left org navigation (not the per-project sidebar). Hidden in Administration. */
export function useShowOrgSidebar(): boolean {
  const inOrg = useMatch('/o/:org/*') !== null;
  const inProject = useShowProjectSidebar();
  const inAdmin = useAdminShell();
  return inOrg && !inProject && !inAdmin;
}

/** The organization dashboard: `/o/:org` and its tabs (Members, Audit log, Settings) that open in
 * place under the same header. */
export function useOrgDashboardHome(): boolean {
  const org = useMatch('/o/:org/*');
  if (!org) return false;
  const rest = (org.params['*'] ?? '').replace(/\/$/, '');
  return (
    rest === '' || rest === 'settings' || rest === 'settings/members' || rest === 'settings/audit'
  );
}

/** Global left navigation: everywhere inside an organization except Administration, which has
 * its own navigation. Project pages keep it and add project tabs. */
export function useShowGlobalSidebar(): boolean {
  const inOrg = useMatch('/o/:org/*') !== null;
  const inAdmin = useAdminShell();
  return inOrg && !inAdmin;
}
