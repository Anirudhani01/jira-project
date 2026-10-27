import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiFetch } from '../../lib/api/client';
import type { CreateOrgRequest, Org, OrgSummary } from '../../lib/api/types';
import { sessionKey } from '../auth/api';

export const orgKey = (slug: string) => ['org', slug.toLowerCase()] as const;

const LAST_ORG_KEY = 'jira.lastOrg';

/** Per-browser convenience only: which org `/` opens. Never used for authorization. */
export function rememberOrg(slug: string): void {
  try {
    localStorage.setItem(LAST_ORG_KEY, slug);
  } catch {
    // Storage may be unavailable (private mode); the app works without it.
  }
}

export function lastOrg(): string | null {
  try {
    return localStorage.getItem(LAST_ORG_KEY);
  } catch {
    return null;
  }
}

export function useOrg(slug: string) {
  return useQuery({
    queryKey: orgKey(slug),
    queryFn: () => apiFetch<Org>(`/orgs/${encodeURIComponent(slug)}`),
  });
}

export function useCreateOrg() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateOrgRequest) =>
      apiFetch<OrgSummary>('/orgs', { method: 'POST', json: body }),
    // The session lists the caller's orgs (switcher).
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: sessionKey });
    },
  });
}

export function useRenameOrg(slug: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      apiFetch<Org>(`/orgs/${encodeURIComponent(slug)}`, { method: 'PATCH', json: { name } }),
    onSuccess: async (org) => {
      queryClient.setQueryData(orgKey(slug), org);
      await queryClient.invalidateQueries({ queryKey: sessionKey });
    },
  });
}
