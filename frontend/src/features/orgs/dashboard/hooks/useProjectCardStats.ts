import { useQuery } from '@tanstack/react-query';

import { fetchProjectMemberCount } from './fetchProjectMemberCount';

export type ProjectCardStats = { memberCount: number };

const statsKey = (org: string, keys: string[]) =>
  [
    'org',
    org.toLowerCase(),
    'dashboard',
    'project-card-stats',
    [...keys].sort().join(','),
  ] as const;

/**
 * Loads per-project member counts after the project list is shown (issue and done counts
 * already come with the list).
 * Fetches one project at a time to avoid a parallel request storm.
 */
export function useProjectCardStats(org: string, keys: string[], enabled: boolean) {
  return useQuery({
    queryKey: statsKey(org, keys),
    enabled: enabled && keys.length > 0,
    staleTime: 120_000,
    queryFn: async () => {
      const map = new Map<string, ProjectCardStats>();
      for (const key of keys) {
        map.set(key, { memberCount: await fetchProjectMemberCount(org, key) });
      }
      return map;
    },
  });
}
