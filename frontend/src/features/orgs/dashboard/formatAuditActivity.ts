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
