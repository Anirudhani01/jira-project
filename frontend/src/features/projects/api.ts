import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiFetch } from '../../lib/api/client';
import type { Project, ProjectMember, ProjectSummary, Workflow } from '../../lib/api/types';

const base = (org: string) => `/orgs/${encodeURIComponent(org)}/projects`;
const projectPath = (org: string, key: string) => `${base(org)}/${encodeURIComponent(key)}`;
export const projectsKey = (org: string) => ['org', org.toLowerCase(), 'projects'] as const;
export const projectKey = (org: string, key: string) =>
  [...projectsKey(org), key.toUpperCase()] as const;

export function useProjects(org: string, options?: { enabled?: boolean; archived?: boolean }) {
  const archived = options?.archived ?? false;
  return useQuery({
    queryKey: archived ? ([...projectsKey(org), 'archived'] as const) : projectsKey(org),
    enabled: (options?.enabled ?? true) && org.length > 0,
    queryFn: () =>
      apiFetch<{ items: ProjectSummary[] }>(`${base(org)}${archived ? '?archived=true' : ''}`).then(
        (r) => r.items,
      ),
  });
}

export function useProject(org: string, key: string) {
  return useQuery({
    queryKey: projectKey(org, key),
    queryFn: () => apiFetch<Project>(projectPath(org, key)),
  });
}

export function useWorkflow(org: string, key: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: [...projectKey(org, key), 'workflow'],
    enabled: (options?.enabled ?? true) && org.length > 0 && key.length > 0,
    queryFn: () => apiFetch<Workflow>(`${projectPath(org, key)}/workflow`),
  });
}

export function useProjectMembers(org: string, key: string) {
  return useQuery({
    queryKey: [...projectKey(org, key), 'members'],
    queryFn: () =>
      apiFetch<{ items: ProjectMember[] }>(`${projectPath(org, key)}/members`).then((r) => r.items),
  });
}

function useProjectsMutation<T, R>(org: string, fn: (vars: T) => Promise<R>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: projectsKey(org) });
    },
  });
}

export function useCreateProject(org: string) {
  return useProjectsMutation(
    org,
    (body: { key: string; name: string; board_type: 'kanban' | 'scrum' }) =>
      apiFetch<ProjectSummary>(base(org), { method: 'POST', json: body }),
  );
}

export function useSetArchived(org: string, key: string) {
  return useProjectsMutation(org, (archived: boolean) =>
    apiFetch<undefined>(`${projectPath(org, key)}/${archived ? 'archive' : 'unarchive'}`, {
      method: 'POST',
    }),
  );
}

export function useAddProjectMember(org: string, key: string) {
  return useProjectsMutation(org, (body: { user_id: string; role: string }) =>
    apiFetch<undefined>(`${projectPath(org, key)}/members`, { method: 'POST', json: body }),
  );
}

export function useRemoveProjectMember(org: string, key: string) {
  return useProjectsMutation(org, (userId: string) =>
    apiFetch<undefined>(`${projectPath(org, key)}/members/${userId}`, { method: 'DELETE' }),
  );
}

export interface ColumnsRequest {
  columns: { id?: string; name: string; wip_limit: number | null; status_ids: string[] }[];
}

/** Replaces the board's columns; the board and the workflow view both change. */
export function useReplaceBoardColumns(org: string, key: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: ColumnsRequest) =>
      apiFetch<unknown>(`${projectPath(org, key)}/board/columns`, { method: 'PUT', json: body }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['org', org.toLowerCase()] }),
  });
}
