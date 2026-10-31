import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiFetch } from '../../lib/api/client';
import type { BulkResult, Epic, Issue, Version } from '../../lib/api/types';
import { issuesKey } from '../issues/api';

import { useRefresh } from './api';

const project = (org: string, key: string) =>
  `/orgs/${encodeURIComponent(org)}/projects/${encodeURIComponent(key)}`;
const versionPath = (org: string, id: string) =>
  `/orgs/${encodeURIComponent(org)}/versions/${encodeURIComponent(id)}`;
const planKey = (org: string, key: string, kind: string, extra: unknown) =>
  ['org', org.toLowerCase(), 'plan', key.toUpperCase(), kind, extra] as const;

/** Epics with child progress; epics in a done status are hidden unless `includeDone`. */
export function useEpics(org: string, key: string, includeDone: boolean, enabled = true) {
  return useQuery({
    queryKey: planKey(org, key, 'epics', includeDone),
    queryFn: () =>
      apiFetch<{ items: Epic[] }>(
        `${project(org, key)}/epics${includeDone ? '?include_done=true' : ''}`,
      ).then((r) => r.items),
    enabled: enabled && Boolean(org && key),
    refetchInterval: 30_000,
  });
}

export function useVersions(org: string, key: string, includeArchived: boolean, enabled = true) {
  return useQuery({
    queryKey: planKey(org, key, 'versions', includeArchived),
    queryFn: () =>
      apiFetch<{ items: Version[] }>(
        `${project(org, key)}/versions${includeArchived ? '?include_archived=true' : ''}`,
      ).then((r) => r.items),
    enabled: enabled && Boolean(org && key),
    refetchInterval: 30_000,
  });
}

/** Epic and version changes also change counts on the backlog and issue lists. */
function useRefreshPlan(org: string, key: string) {
  const queryClient = useQueryClient();
  const refreshBacklog = useRefresh(org, key);
  return async () => {
    await queryClient.invalidateQueries({
      queryKey: ['org', org.toLowerCase(), 'plan', key.toUpperCase()],
    });
    await queryClient.invalidateQueries({ queryKey: [...issuesKey(org)] });
    await refreshBacklog();
  };
}

export function useCreateVersion(org: string, key: string) {
  const refresh = useRefreshPlan(org, key);
  return useMutation({
    mutationFn: (body: {
      name: string;
      description?: string;
      start_date?: string;
      release_date?: string;
    }) => apiFetch<Version>(`${project(org, key)}/versions`, { method: 'POST', json: body }),
    onSettled: refresh,
  });
}

export function useUpdateVersion(org: string, key: string) {
  const refresh = useRefreshPlan(org, key);
  return useMutation({
    mutationFn: ({
      id,
      ...body
    }: {
      id: string;
      name?: string;
      description?: string | null;
      start_date?: string | null;
      release_date?: string | null;
    }) => apiFetch<Version>(versionPath(org, id), { method: 'PATCH', json: body }),
    onSettled: refresh,
  });
}

export function useReleaseVersion(org: string, key: string) {
  const refresh = useRefreshPlan(org, key);
  return useMutation({
    mutationFn: ({
      id,
      ...body
    }: {
      id: string;
      release_date?: string;
      unresolved: 'ignore' | 'move';
      move_to?: string;
    }) =>
      apiFetch<{ version: Version; moved_issues: number }>(`${versionPath(org, id)}/release`, {
        method: 'POST',
        json: body,
      }),
    onSettled: refresh,
  });
}

export function useVersionAction(org: string, key: string) {
  const refresh = useRefreshPlan(org, key);
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'unrelease' | 'archive' | 'unarchive' }) =>
      apiFetch<Version>(`${versionPath(org, id)}/${action}`, { method: 'POST' }),
    onSettled: refresh,
  });
}

export function useDeleteVersion(org: string, key: string) {
  const refresh = useRefreshPlan(org, key);
  return useMutation({
    mutationFn: ({ id, moveTo }: { id: string; moveTo?: string }) =>
      apiFetch<undefined>(
        `${versionPath(org, id)}${moveTo ? `?move_to=${encodeURIComponent(moveTo)}` : ''}`,
        { method: 'DELETE' },
      ),
    onSettled: refresh,
  });
}

export type BulkAction =
  | { action: 'move_sprint'; sprint_id: string | null }
  | { action: 'assign'; assignee_id: string | null }
  | { action: 'set_priority'; priority_id: string }
  | { action: 'set_parent'; parent_id: string | null }
  | { action: 'set_fix_version'; fix_version_id: string | null }
  | { action: 'delete' };

/** One request for the whole selection; the response says which issues changed and which did
 * not (and why), so a partial failure never hides the successes. */
export function useBulkChange(org: string, key: string) {
  const refresh = useRefreshPlan(org, key);
  return useMutation({
    mutationFn: ({ keys, change }: { keys: string[]; change: BulkAction }) =>
      apiFetch<BulkResult>(`/orgs/${encodeURIComponent(org)}/issues/bulk`, {
        method: 'POST',
        json: { keys, ...change },
      }),
    onSettled: refresh,
  });
}

/** Sets or clears one field of one issue (drag onto an epic or a version). */
export function useSetIssueField(org: string, key: string) {
  const refresh = useRefreshPlan(org, key);
  return useMutation({
    mutationFn: ({
      issueKey,
      version,
      changes,
    }: {
      issueKey: string;
      version: number;
      changes: { parent_id: string | null } | { fix_version_id: string | null };
    }) =>
      apiFetch<Issue>(`/orgs/${encodeURIComponent(org)}/issues/${encodeURIComponent(issueKey)}`, {
        method: 'PATCH',
        json: changes,
        headers: { 'If-Match': `"v${String(version)}"` },
      }),
    onSettled: refresh,
  });
}
