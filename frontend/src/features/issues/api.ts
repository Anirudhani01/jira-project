import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiFetch } from '../../lib/api/client';
import type { Issue, IssueActivity, IssueList, IssueType, Priority } from '../../lib/api/types';

const orgBase = (org: string) => `/orgs/${encodeURIComponent(org)}`;
const issuePath = (org: string, key: string) => `${orgBase(org)}/issues/${encodeURIComponent(key)}`;
export const issuesKey = (org: string) => ['org', org.toLowerCase(), 'issues'] as const;
const issueKey = (org: string, key: string) => [...issuesKey(org), key.toUpperCase()] as const;

export interface IssueFilters {
  project: string;
  status_category?: string;
  type?: string;
  priority?: string;
  assignee?: string;
}

export function useIssues(org: string, filters: IssueFilters) {
  return useInfiniteQuery({
    queryKey: [...issuesKey(org), 'list', filters],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams(
        Object.entries(filters).filter((entry): entry is [string, string] => Boolean(entry[1])),
      );
      if (pageParam) params.set('cursor', pageParam);
      return apiFetch<IssueList>(`${orgBase(org)}/issues?${params.toString()}`);
    },
    getNextPageParam: (last) => last.next_cursor,
  });
}

export function useIssue(org: string, key: string) {
  return useQuery({
    queryKey: issueKey(org, key),
    queryFn: () => apiFetch<Issue>(issuePath(org, key)),
  });
}

export function useIssueActivity(org: string, key: string) {
  return useQuery({
    queryKey: [...issueKey(org, key), 'activity'],
    queryFn: () =>
      apiFetch<{ items: IssueActivity[] }>(`${issuePath(org, key)}/activity`).then((r) => r.items),
  });
}

export function useIssueTypes(org: string) {
  return useQuery({
    queryKey: ['org', org.toLowerCase(), 'issue-types'],
    queryFn: () =>
      apiFetch<{ items: IssueType[] }>(`${orgBase(org)}/issue-types`).then((r) => r.items),
  });
}

export function usePriorities(org: string) {
  return useQuery({
    queryKey: ['org', org.toLowerCase(), 'priorities'],
    queryFn: () =>
      apiFetch<{ items: Priority[] }>(`${orgBase(org)}/priorities`).then((r) => r.items),
  });
}

export interface NewIssue {
  type_id: string;
  priority_id: string;
  summary: string;
  description?: string;
}

/** Create with an Idempotency-Key, so a retried submission never creates a duplicate. */
export function useCreateIssue(org: string, project: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ body, idempotencyKey }: { body: NewIssue; idempotencyKey: string }) =>
      apiFetch<Issue>(`${orgBase(org)}/projects/${encodeURIComponent(project)}/issues`, {
        method: 'POST',
        json: body,
        headers: { 'Idempotency-Key': idempotencyKey },
      }),
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: issuesKey(org) });
    },
  });
}

export type IssueChanges = Partial<Pick<NewIssue, 'summary' | 'type_id' | 'priority_id'>> & {
  description?: string | null;
};

/** PATCH with If-Match: a stale version answers 412 (shown as a conflict). */
export function useUpdateIssue(org: string, key: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ changes, version }: { changes: IssueChanges; version: number }) =>
      apiFetch<Issue>(issuePath(org, key), {
        method: 'PATCH',
        json: changes,
        headers: { 'If-Match': `"v${String(version)}"` },
      }),
    onSuccess: (issue) => {
      queryClient.setQueryData(issueKey(org, key), issue);
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: [...issueKey(org, key), 'activity'] });
      await queryClient.invalidateQueries({ queryKey: [...issuesKey(org), 'list'] });
    },
  });
}

export function useDeleteIssue(org: string, key: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<undefined>(issuePath(org, key), { method: 'DELETE' }),
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: [...issuesKey(org), 'list'] });
    },
  });
}
