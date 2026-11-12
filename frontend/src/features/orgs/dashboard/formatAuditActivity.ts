import type { AuditEvent, Member } from '../../../lib/api/types';

export function memberDisplayNameByUserId(members: Member[]): Map<string, string> {
  return new Map(members.map((m) => [m.user_id, m.display_name]));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A name a person would recognise: a key, name or slug from the event, else a non-UUID id. */
export function auditTargetDetail(event: AuditEvent): string | null {
  for (const field of ['key', 'name', 'slug']) {
    const value = event.metadata[field];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  if (event.target_id && !UUID.test(event.target_id)) return event.target_id;
  return null;
}

export function describeAuditEvent(event: AuditEvent, membersById: Map<string, string>): string {
  const actor = event.actor_user_id
    ? (membersById.get(event.actor_user_id) ?? 'A team member')
    : 'System';
  const action = event.action.replaceAll('.', ' ').replaceAll('_', ' ');
  const detail = auditTargetDetail(event);
  return `${actor} ${action}${detail ? ` (${detail})` : ''}`;
}
