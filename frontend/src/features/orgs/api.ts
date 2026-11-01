import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiFetch } from '../../lib/api/client';
import type {
  CreateOrgRequest,
  Invitation,
  JoinedOrg,
  Member,
  Org,
  OrgSettings,
  OrgSummary,
  UpdateOrgSettingsRequest,
} from '../../lib/api/types';
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

export const orgSettingsKey = (slug: string) => ['org', slug.toLowerCase(), 'settings'] as const;

export function useOrgSettings(slug: string) {
  return useQuery({
    queryKey: orgSettingsKey(slug),
    enabled: Boolean(slug),
    queryFn: () => apiFetch<OrgSettings>(`/orgs/${encodeURIComponent(slug)}/settings`),
  });
}

export function useUpdateOrgSettings(slug: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateOrgSettingsRequest) =>
      apiFetch<OrgSettings>(`/orgs/${encodeURIComponent(slug)}/settings`, {
        method: 'PATCH',
        json: body,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: orgSettingsKey(slug) });
    },
  });
}

// ----------------------------------------------------------------------------- M4
export const membersKey = (slug: string) => ['org', slug.toLowerCase(), 'members'] as const;
export const invitationsKey = (slug: string) => ['org', slug.toLowerCase(), 'invitations'] as const;

export function useMembers(slug: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: membersKey(slug),
    enabled: options?.enabled ?? Boolean(slug),
    queryFn: () =>
      apiFetch<{ items: Member[] }>(`/orgs/${encodeURIComponent(slug)}/members`).then(
        (r) => r.items,
      ),
  });
}

export function useInvitations(slug: string, enabled: boolean) {
  return useQuery({
    queryKey: invitationsKey(slug),
    enabled,
    queryFn: () =>
      apiFetch<{ items: Invitation[] }>(`/orgs/${encodeURIComponent(slug)}/invitations`).then(
        (r) => r.items,
      ),
  });
}

function useOrgMutation<T>(slug: string, fn: (vars: T) => Promise<unknown>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: ['org', slug.toLowerCase()] });
    },
  });
}

export function useUpdateMember(slug: string) {
  return useOrgMutation(
    slug,
    ({ userId, ...body }: { userId: string; role?: string; can_create_projects?: boolean }) =>
      apiFetch<undefined>(`/orgs/${encodeURIComponent(slug)}/members/${userId}`, {
        method: 'PATCH',
        json: body,
      }),
  );
}

export function useRemoveMember(slug: string) {
  return useOrgMutation(slug, (userId: string) =>
    apiFetch<undefined>(`/orgs/${encodeURIComponent(slug)}/members/${userId}`, {
      method: 'DELETE',
    }),
  );
}

export function useInvite(slug: string) {
  return useOrgMutation(slug, (body: { email: string; role: string }) =>
    apiFetch<{ status: string }>(`/orgs/${encodeURIComponent(slug)}/invitations`, {
      method: 'POST',
      json: body,
    }),
  );
}

export function useRevokeInvitation(slug: string) {
  return useOrgMutation(slug, (id: string) =>
    apiFetch<undefined>(`/orgs/${encodeURIComponent(slug)}/invitations/${id}`, {
      method: 'DELETE',
    }),
  );
}

export function useAcceptInvitation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (token: string) =>
      apiFetch<JoinedOrg>('/invitations/accept', { method: 'POST', json: { token } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: sessionKey });
    },
  });
}
