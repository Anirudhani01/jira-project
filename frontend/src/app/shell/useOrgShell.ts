import { useMatch } from 'react-router';

import { useShowProjectSidebar } from './useProjectContext';

/** Org slug from `/o/:org/...` when the user is inside an organization (with or without a project). */
export function useOrgSlug(): string | null {
  const match = useMatch('/o/:org/*');
  return match?.params.org ?? null;
}

/** Left org navigation (not the per-project sidebar). */
export function useShowOrgSidebar(): boolean {
  const inOrg = useMatch('/o/:org/*') !== null;
  const inProject = useShowProjectSidebar();
  return inOrg && !inProject;
}

/** Organization home dashboard at `/o/:org` (scoped blue shell in M1+). */
export function useOrgDashboardHome(): boolean {
  return useMatch({ path: '/o/:org', end: true }) !== null;
}
