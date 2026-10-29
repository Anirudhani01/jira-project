import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiFetch } from '../../lib/api/client';
import type { Board, Issue } from '../../lib/api/types';
import { issuesKey } from '../issues/api';

import { applyMove, type MovePlan } from './boardState';

const boardKey = (org: string, project: string) =>
  ['org', org.toLowerCase(), 'board', project.toUpperCase()] as const;

/** Freshness: refetch on focus plus 30 s polling (plan §5.1). */
export function useBoard(org: string, project: string) {
  return useQuery({
    queryKey: boardKey(org, project),
    queryFn: () =>
      apiFetch<Board>(
        `/orgs/${encodeURIComponent(org)}/projects/${encodeURIComponent(project)}/board`,
      ),
    refetchInterval: 30_000,
  });
}

export interface MoveArgs {
  key: string;
  columnId: string;
  index: number;
  /** Computed from the board *before* the optimistic update (see `planMove`). */
  plan: MovePlan;
  version: number;
}

/** Optimistic move (plan §5.7): snapshot, move the card, `POST /move`; on failure restore
 * the snapshot (the page shows the error); always refetch afterwards. */
export function useMoveCard(org: string, project: string) {
  const queryClient = useQueryClient();
  const queryKey = boardKey(org, project);
  return useMutation({
    mutationFn: ({ key, plan, version }: MoveArgs) =>
      apiFetch<Issue>(`/orgs/${encodeURIComponent(org)}/issues/${encodeURIComponent(key)}/move`, {
        method: 'POST',
        json: {
          ...(plan.statusChanged ? { to_status_id: plan.toStatusId } : {}),
          ...(plan.afterKey ? { after_key: plan.afterKey } : {}),
          ...(plan.beforeKey ? { before_key: plan.beforeKey } : {}),
        },
        ...(plan.statusChanged ? { headers: { 'If-Match': `"v${String(version)}"` } } : {}),
      }),
    onMutate: async ({ key, columnId, index }) => {
      await queryClient.cancelQueries({ queryKey });
      const snapshot = queryClient.getQueryData<Board>(queryKey);
      if (snapshot) queryClient.setQueryData(queryKey, applyMove(snapshot, key, columnId, index));
      return { snapshot };
    },
    onError: (_error, _args, context) => {
      if (context?.snapshot) queryClient.setQueryData(queryKey, context.snapshot);
    },
    onSettled: async (_data, _error, { key }) => {
      await queryClient.invalidateQueries({ queryKey });
      await queryClient.invalidateQueries({ queryKey: [...issuesKey(org), key.toUpperCase()] });
    },
  });
}
