import type { Notification } from '../../lib/api/types';

export interface NotificationGroup {
  label: 'Today' | 'Earlier';
  items: Notification[];
}

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

/** Splits newest-first notifications into Today / Earlier (local days); empty groups are dropped. */
export function groupNotifications(items: Notification[], now = new Date()): NotificationGroup[] {
  const today = items.filter((n) => sameDay(new Date(n.created_at), now));
  const earlier = items.filter((n) => !sameDay(new Date(n.created_at), now));
  const groups: NotificationGroup[] = [
    { label: 'Today', items: today },
    { label: 'Earlier', items: earlier },
  ];
  return groups.filter((g) => g.items.length > 0);
}

/** Issue page, jumping to the comment when the notification carries one. */
export function notificationHref(org: string, n: Notification): string {
  const commentId = (n.payload as { comment_id?: unknown }).comment_id;
  const base = `/o/${org}/issues/${n.issue_key}`;
  return typeof commentId === 'string' && commentId ? `${base}#comment-${commentId}` : base;
}
