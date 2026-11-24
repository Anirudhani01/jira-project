import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiFetch } from '../../lib/api/client';
import type { SavedFilter } from '../../lib/api/types';

const base = (org: string, project: string) =>
  `/orgs/${encodeURIComponent(org)}/projects/${encodeURIComponent(project)}/saved-filters`;

const savedFiltersKey = (org: string, project: string) =>
  ['org', org.toLowerCase(), 'project', project.toUpperCase(), 'saved-filters'] as const;

/** The signed-in user's own saved filters for a project (the server returns only theirs). */
export function useSavedFilters(org: string, project: string) {
  return useQuery({
    queryKey: savedFiltersKey(org, project),
    queryFn: () =>
      apiFetch<{ items: SavedFilter[] }>(base(org, project)).then((response) => response.items),
  });
}

function useInvalidate(org: string, project: string) {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: savedFiltersKey(org, project) });
}

export function useCreateSavedFilter(org: string, project: string) {
  const invalidate = useInvalidate(org, project);
  return useMutation({
    mutationFn: (body: { name: string; params: Record<string, string> }) =>
      apiFetch<SavedFilter>(base(org, project), { method: 'POST', json: body }),
    onSuccess: invalidate,
  });
}

export function useRenameSavedFilter(org: string, project: string) {
  const invalidate = useInvalidate(org, project);
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      apiFetch<SavedFilter>(`${base(org, project)}/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        json: { name },
      }),
    onSuccess: invalidate,
  });
}

export function useDeleteSavedFilter(org: string, project: string) {
  const invalidate = useInvalidate(org, project);
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<undefined>(`${base(org, project)}/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      }),
    onSuccess: invalidate,
  });
}
