import { useQuery } from '@tanstack/react-query';

import { fetchProjectSecondaryStats } from './fetchProjectSecondaryStats';

export type ProjectCardStats = { issueCount: number; memberCount: number };

const statsKey = (org: string, keys: string[]) =>
  ['org', org.toLowerCase(), 'dashboard', 'project-card-stats', [...keys].sort().join(',')] as const;

/**
 * Loads per-project issue/member counts after the project list is shown.
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
        map.set(key, await fetchProjectSecondaryStats(org, key));
      }
      return map;
    },
  });
}
