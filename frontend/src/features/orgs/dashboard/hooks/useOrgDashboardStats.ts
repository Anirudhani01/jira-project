import { useQuery } from '@tanstack/react-query';

import { apiFetch } from '../../../../lib/api/client';
import type { Board } from '../../../../lib/api/types';
import { useMembers } from '../../api';
import { useProjects } from '../../../projects/api';

import { sumBoardIssueCount } from './fetchProjectSecondaryStats';

const issueTotalKey = (org: string, keys: string[]) =>
  ['org', org.toLowerCase(), 'dashboard', 'issue-total', [...keys].sort().join(',')] as const;

/** Primary counts from list endpoints; issue total fetched sequentially (avoids parallel board N+1). */
export function useOrgDashboardStats(org: string) {
  const projects = useProjects(org);
  const members = useMembers(org);

  const activeKeys = (projects.data ?? []).filter((p) => !p.archived).map((p) => p.key);

  const issueTotal = useQuery({
    queryKey: issueTotalKey(org, activeKeys),
    enabled: projects.isSuccess && activeKeys.length > 0,
    staleTime: 120_000,
    queryFn: async () => {
      let total = 0;
      for (const key of activeKeys) {
        const board = await apiFetch<Board>(
          `/orgs/${encodeURIComponent(org)}/projects/${encodeURIComponent(key)}/board`,
        );
        total += sumBoardIssueCount(board);
      }
      return total;
    },
  });

  const noProjects = projects.isSuccess && activeKeys.length === 0;

  return {
    projectCount: projects.isSuccess
      ? projects.data.filter((p) => !p.archived).length
      : null,
    memberCount: members.isSuccess ? members.data.length : null,
    issueTotal: noProjects ? 0 : (issueTotal.data ?? null),
    issueTotalPending:
      !noProjects && activeKeys.length > 0 && (issueTotal.isPending || issueTotal.isFetching),
    issueTotalError: issueTotal.isError,
    projectsReady: projects.isSuccess,
    membersReady: members.isSuccess,
  };
}
