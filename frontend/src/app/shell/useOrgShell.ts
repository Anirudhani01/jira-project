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

/** Organization home dashboard at `/o/:org` (scoped blue shell in M1+). */
export function useOrgDashboardHome(): boolean {
  return useMatch({ path: '/o/:org', end: true }) !== null;
}

/** Global left navigation: everywhere inside an organization except Administration, which has
 * its own navigation. Project pages keep it and add project tabs. */
export function useShowGlobalSidebar(): boolean {
  const inOrg = useMatch('/o/:org/*') !== null;
  const inAdmin = useAdminShell();
  return inOrg && !inAdmin;
}
