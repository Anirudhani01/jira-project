import { useMutation, useQueryClient } from '@tanstack/react-query';

import { apiFetch } from '../../lib/api/client';
import type { IssueType, Priority } from '../../lib/api/types';

const typesKey = (org: string) => ['org', org.toLowerCase(), 'issue-types'] as const;
const prioritiesKey = (org: string) => ['org', org.toLowerCase(), 'priorities'] as const;

export function useCreateIssueType(org: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; kind: string }) =>
      apiFetch<IssueType>(`/orgs/${encodeURIComponent(org)}/issue-types`, {
        method: 'POST',
        json: body,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: typesKey(org) });
    },
  });
}

export function useUpdateIssueType(org: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; name?: string; is_active?: boolean }) =>
      apiFetch<IssueType>(`/orgs/${encodeURIComponent(org)}/issue-types/${id}`, {
        method: 'PATCH',
        json: body,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: typesKey(org) });
    },
  });
}

export function useReorderIssueTypes(org: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) =>
      apiFetch<{ items: IssueType[] }>(`/orgs/${encodeURIComponent(org)}/issue-types/order`, {
        method: 'PUT',
        json: { ids },
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(typesKey(org), data.items);
    },
  });
}

export function useCreatePriority(org: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; color: string }) =>
      apiFetch<Priority>(`/orgs/${encodeURIComponent(org)}/priorities`, {
        method: 'POST',
        json: body,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: prioritiesKey(org) });
    },
  });
}

export function useUpdatePriority(org: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...body
    }: {
      id: string;
      name?: string;
      color?: string;
      is_active?: boolean;
    }) =>
      apiFetch<Priority>(`/orgs/${encodeURIComponent(org)}/priorities/${id}`, {
        method: 'PATCH',
        json: body,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: prioritiesKey(org) });
    },
  });
}

export function useReorderPriorities(org: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) =>
      apiFetch<{ items: Priority[] }>(`/orgs/${encodeURIComponent(org)}/priorities/order`, {
        method: 'PUT',
        json: { ids },
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(prioritiesKey(org), data.items);
    },
  });
}
