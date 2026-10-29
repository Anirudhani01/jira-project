import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { apiFetch } from '../../lib/api/client';
import type { Comment, CommentList } from '../../lib/api/types';

const orgBase = (org: string) => `/orgs/${encodeURIComponent(org)}`;
const issueCommentsPath = (org: string, issueKey: string) =>
  `${orgBase(org)}/issues/${encodeURIComponent(issueKey)}/comments`;
const commentPath = (org: string, id: string) =>
  `${orgBase(org)}/comments/${encodeURIComponent(id)}`;

export const commentsKey = (org: string, issueKey: string) =>
  ['org', org.toLowerCase(), 'issues', issueKey.toUpperCase(), 'comments'] as const;

export function useComments(org: string, issueKey: string) {
  return useInfiniteQuery({
    queryKey: commentsKey(org, issueKey),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams();
      if (pageParam) params.set('cursor', pageParam);
      const query = params.toString();
      return apiFetch<CommentList>(
        `${issueCommentsPath(org, issueKey)}${query ? `?${query}` : ''}`,
      );
    },
    getNextPageParam: (last) => last.next_cursor,
  });
}

/** Create with an Idempotency-Key, so a retried submission never posts a duplicate. */
export function useCreateComment(org: string, issueKey: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ body, idempotencyKey }: { body: string; idempotencyKey: string }) =>
      apiFetch<Comment>(issueCommentsPath(org, issueKey), {
        method: 'POST',
        json: { body },
        headers: { 'Idempotency-Key': idempotencyKey },
      }),
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: commentsKey(org, issueKey) });
    },
  });
}

/** Comments have no version/ETag: edits are last-write-wins, gated by authorship on the
 * server, not by optimistic concurrency. */
export function useUpdateComment(org: string, issueKey: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: string }) =>
      apiFetch<Comment>(commentPath(org, id), { method: 'PATCH', json: { body } }),
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: commentsKey(org, issueKey) });
    },
  });
}

export function useDeleteComment(org: string, issueKey: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<undefined>(commentPath(org, id), { method: 'DELETE' }),
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: commentsKey(org, issueKey) });
    },
  });
}
