import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiFetch } from '../../lib/api/client';
import type { NotificationList } from '../../lib/api/types';

const base = (org: string) => `/orgs/${encodeURIComponent(org)}/notifications`;
const notificationsKey = (org: string) => ['org', org.toLowerCase(), 'notifications'] as const;

/** Unread badge: refetched on focus and polled every 30 s (plan §5.1). */
export function useUnreadCount(org: string) {
  return useQuery({
    queryKey: [...notificationsKey(org), 'unread-count'],
    queryFn: () => apiFetch<{ count: number }>(`${base(org)}/unread-count`).then((r) => r.count),
    refetchInterval: 30_000,
  });
}

export function useNotifications(org: string, enabled: boolean) {
  return useQuery({
    queryKey: [...notificationsKey(org), 'list'],
    queryFn: () => apiFetch<NotificationList>(base(org)),
    enabled,
  });
}

export function useMarkRead(org: string) {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: notificationsKey(org) });
  const one = useMutation({
    mutationFn: (id: string) => apiFetch<undefined>(`${base(org)}/${id}/read`, { method: 'POST' }),
    onSettled: refresh,
  });
  const all = useMutation({
    mutationFn: () => apiFetch<{ updated: number }>(`${base(org)}/read-all`, { method: 'POST' }),
    onSettled: refresh,
  });
  return { one, all };
}
