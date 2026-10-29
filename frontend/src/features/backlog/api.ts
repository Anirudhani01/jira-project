import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiFetch } from '../../lib/api/client';
import type { Backlog, CompleteSprintResult, Issue, Sprint } from '../../lib/api/types';
import { issuesKey } from '../issues/api';

const projectPath = (org: string, project: string) =>
  `/orgs/${encodeURIComponent(org)}/projects/${encodeURIComponent(project)}`;
const sprintPath = (org: string, id: string) =>
  `/orgs/${encodeURIComponent(org)}/sprints/${encodeURIComponent(id)}`;
const backlogKey = (org: string, project: string) =>
  ['org', org.toLowerCase(), 'backlog', project.toUpperCase()] as const;

export function useBacklog(org: string, project: string) {
  return useQuery({
    queryKey: backlogKey(org, project),
    queryFn: () => apiFetch<Backlog>(`${projectPath(org, project)}/backlog`),
    refetchInterval: 30_000,
  });
}

/** Every sprint mutation refreshes the backlog and the (scrum) board. */
function useRefresh(org: string, project: string) {
  const queryClient = useQueryClient();
  return async () => {
    await queryClient.invalidateQueries({ queryKey: backlogKey(org, project) });
    await queryClient.invalidateQueries({
      queryKey: ['org', org.toLowerCase(), 'board', project.toUpperCase()],
    });
    await queryClient.invalidateQueries({ queryKey: [...issuesKey(org), 'list'] });
  };
}

export function useCreateSprint(org: string, project: string) {
  const refresh = useRefresh(org, project);
  return useMutation({
    mutationFn: (body: { name: string; goal?: string }) =>
      apiFetch<Sprint>(`${projectPath(org, project)}/sprints`, { method: 'POST', json: body }),
    onSettled: refresh,
  });
}

export function useStartSprint(org: string, project: string) {
  const refresh = useRefresh(org, project);
  return useMutation({
    mutationFn: ({ id, start_at, end_at }: { id: string; start_at: string; end_at: string }) =>
      apiFetch<Sprint>(`${sprintPath(org, id)}/start`, {
        method: 'POST',
        json: { start_at, end_at },
      }),
    onSettled: refresh,
  });
}

export function useCompleteSprint(org: string, project: string) {
  const refresh = useRefresh(org, project);
  return useMutation({
    mutationFn: ({ id, target }: { id: string; target: string }) =>
      apiFetch<CompleteSprintResult>(`${sprintPath(org, id)}/complete`, {
        method: 'POST',
        json: { move_open_issues_to: target },
      }),
    onSettled: refresh,
  });
}

export function useDeleteSprint(org: string, project: string) {
  const refresh = useRefresh(org, project);
  return useMutation({
    mutationFn: (id: string) => apiFetch<undefined>(sprintPath(org, id), { method: 'DELETE' }),
    onSettled: refresh,
  });
}

/** Moves an issue into a sprint (or back to the backlog with `sprintId: null`). Sends
 * `If-Match` because a sprint change bumps the issue's version. */
export function useMoveToSprint(org: string, project: string) {
  const refresh = useRefresh(org, project);
  return useMutation({
    mutationFn: ({
      key,
      version,
      sprintId,
    }: {
      key: string;
      version: number;
      sprintId: string | null;
    }) =>
      apiFetch<Issue>(`/orgs/${encodeURIComponent(org)}/issues/${encodeURIComponent(key)}/move`, {
        method: 'POST',
        json: { sprint_id: sprintId },
        headers: { 'If-Match': `"v${String(version)}"` },
      }),
    onSettled: refresh,
  });
}
