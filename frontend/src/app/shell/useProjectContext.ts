import { useMatch } from 'react-router';

/** Active project segment from `/o/:org/p/:key/...` (sidebar + switcher). */
export function useProjectContext():
  { org: string; projectKey: string } | { org: string; projectKey: null } | null {
  const projectMatch = useMatch('/o/:org/p/:projectKey/*');
  const orgMatch = useMatch('/o/:org/*');

  if (projectMatch?.params.org && projectMatch.params.projectKey) {
    return {
      org: projectMatch.params.org,
      projectKey: projectMatch.params.projectKey.toUpperCase(),
    };
  }
  if (orgMatch?.params.org) {
    return { org: orgMatch.params.org, projectKey: null };
  }
  return null;
}

export function useShowProjectSidebar(): boolean {
  return useMatch('/o/:org/p/:projectKey/*') !== null;
}
