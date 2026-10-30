import type { AuditEvent, Member } from '../../../lib/api/types';

export function memberDisplayNameByUserId(members: Member[]): Map<string, string> {
  return new Map(members.map((m) => [m.user_id, m.display_name]));
}

export function describeAuditEvent(event: AuditEvent, membersById: Map<string, string>): string {
  const actor = event.actor_user_id
    ? (membersById.get(event.actor_user_id) ?? 'A team member')
    : 'System';
  const action = event.action.replaceAll('.', ' ').replaceAll('_', ' ');
  const target =
    event.target_type && event.target_id
      ? ` (${event.target_type} ${event.target_id})`
      : event.target_type
        ? ` (${event.target_type})`
        : '';
  return `${actor} ${action}${target}`;
}

export function formatRelativeTime(iso: string, now = Date.now()): string {
  const then = new Date(iso).getTime();
  const diffSec = Math.round((then - now) / 1000);
  const abs = Math.abs(diffSec);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  if (abs < 60) return rtf.format(diffSec, 'second');
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), 'hour');
  return rtf.format(Math.round(diffSec / 86400), 'day');
}
