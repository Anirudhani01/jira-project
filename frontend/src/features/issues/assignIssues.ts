import { useMutation, useQueryClient } from '@tanstack/react-query';

import { apiFetch } from '../../lib/api/client';
import type { BulkResult } from '../../lib/api/types';

/** Assigns (or unassigns with `null`) issues through the bulk endpoint, which needs no
 * version and reports a result per issue. Everything cached for the organization is refreshed
 * because the change shows up on boards, lists, the backlog and the issue page. */
export function useAssignIssues(org: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ keys, assigneeId }: { keys: string[]; assigneeId: string | null }) =>
      apiFetch<BulkResult>(`/orgs/${encodeURIComponent(org)}/issues/bulk`, {
        method: 'POST',
        json: { keys, action: 'assign', assignee_id: assigneeId },
      }),
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: ['org', org.toLowerCase()] });
    },
  });
}
