import type { Member } from '../../lib/api/types';

export function buildMemberById(members: Member[]): Map<string, Member> {
  return new Map(members.map((m) => [m.user_id, m]));
}

/** Labels for audit actor_user_id (org audit_events semantics). */
export function formatAuditActor(
  actorUserId: string | null | undefined,
  memberById: Map<string, Member>,
  membersLoaded: boolean,
): string {
  if (actorUserId == null) return 'No actor';
  const member = memberById.get(actorUserId);
  if (member) return member.display_name;
  if (!membersLoaded) return '…';
  return 'Former member';
}

export function formatActorFilterLabel(
  actorId: string | undefined,
  memberById: Map<string, Member>,
): string | undefined {
  if (!actorId) return undefined;
  return formatAuditActor(actorId, memberById, true);
}
