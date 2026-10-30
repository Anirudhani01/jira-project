import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiFetch, setCsrfToken } from '../../lib/api/client';
import { refreshSessionCsrf } from '../../lib/ux/csrfRecovery';

import { notifyConfirmedLogout } from './establishedSession';
import { setLogoutIntent } from './logoutIntent';
import { ApiError } from '../../lib/api/errors';
import type {
  ChangePasswordRequest,
  LoginRequest,
  PasswordResetConfirmRequest,
  PasswordResetRequest,
  SessionList,
  SessionState,
  SignupRequest,
  UpdateProfileRequest,
  User,
  VerifyEmailRequest,
} from '../../lib/api/types';

export const sessionKey = ['auth', 'session'] as const;
export const sessionsKey = ['me', 'sessions'] as const;

/** Current session, or null when signed out. Keeps the in-memory CSRF token in sync. */
export async function fetchSession(): Promise<SessionState | null> {
  try {
    const state = await apiFetch<SessionState>('/auth/session');
    setCsrfToken(state.csrf_token);
    return state;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      setCsrfToken(null);
      return null;
    }
    throw error;
  }
}

export function useSession() {
  return useQuery({ queryKey: sessionKey, queryFn: fetchSession, staleTime: 60_000 });
}

export function useSignup() {
  return useMutation({
    mutationFn: (body: SignupRequest) =>
      apiFetch<{ status: 'accepted' }>('/auth/signup', { method: 'POST', json: body }),
  });
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: LoginRequest) =>
      apiFetch<undefined>('/auth/login', { method: 'POST', json: body }),
    meta: { uxAuthSurface: 'login' },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: sessionKey });
    },
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<undefined>('/auth/logout', { method: 'POST' }),
    onMutate: () => {
      setLogoutIntent(true);
    },
    onSettled: () => {
      setLogoutIntent(false);
    },
    // Only forget the session once the server confirms it was revoked. Clearing state on a
    // failed logout would show "signed out" while the session cookie is still valid.
    onSuccess: () => {
      setCsrfToken(null);
      // Drop every cached server response that belonged to the signed-in user.
      queryClient.clear();
      queryClient.setQueryData(sessionKey, null);
      notifyConfirmedLogout();
    },
    onError: async () => {
      await refreshSessionCsrf(queryClient);
    },
  });
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateProfileRequest) =>
      apiFetch<User>('/me', { method: 'PATCH', json: body }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: sessionKey });
    },
  });
}

export function useChangePassword() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: ChangePasswordRequest) =>
      apiFetch<undefined>('/me/password', { method: 'POST', json: body }),
    // The session was rotated: fetch the new CSRF token and the shortened session list.
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: sessionKey });
      await queryClient.invalidateQueries({ queryKey: sessionsKey });
    },
  });
}

export function useSessions() {
  return useQuery({
    queryKey: sessionsKey,
    queryFn: () => apiFetch<SessionList>('/me/sessions'),
  });
}

export function useRevokeSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) =>
      apiFetch<undefined>(`/me/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: sessionsKey });
    },
  });
}

export function useRevokeOtherSessions() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<undefined>('/me/sessions/revoke-others', { method: 'POST' }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: sessionsKey });
    },
  });
}

export function useVerifyEmail() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: VerifyEmailRequest) =>
      apiFetch<undefined>('/auth/verify-email', { method: 'POST', json: body }),
    // The current session (if it was the token owner's) was rotated and every other one
    // revoked: refetch the session and its new CSRF token.
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: sessionKey });
    },
  });
}

export function useRequestPasswordReset() {
  return useMutation({
    mutationFn: (body: PasswordResetRequest) =>
      apiFetch<{ status: 'accepted' }>('/auth/password-reset/request', {
        method: 'POST',
        json: body,
      }),
  });
}

export function useConfirmPasswordReset() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: PasswordResetConfirmRequest) =>
      apiFetch<undefined>('/auth/password-reset/confirm', { method: 'POST', json: body }),
    // Every session (including this browser's) was revoked; nothing cached is valid.
    onSuccess: () => {
      setCsrfToken(null);
      queryClient.clear();
      queryClient.setQueryData(sessionKey, null);
    },
  });
}
