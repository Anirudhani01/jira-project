import { describe, expect, it } from 'vitest';

import { buildMemberById, formatAuditActor } from './auditActorLabel';

const MEMBER = {
  user_id: '11111111-1111-1111-1111-111111111111',
  display_name: 'Alex Admin',
  email: 'alex@example.com',
  role: 'admin',
  can_create_projects: true,
  joined_at: '2026-10-01T00:00:00Z',
};

describe('auditActorLabel', () => {
  const map = buildMemberById([MEMBER]);

  it('labels null actor as No actor', () => {
    expect(formatAuditActor(null, map, true)).toBe('No actor');
    expect(formatAuditActor(undefined, map, true)).toBe('No actor');
  });

  it('labels known member by display name', () => {
    expect(formatAuditActor(MEMBER.user_id, map, true)).toBe('Alex Admin');
  });

  it('labels unknown uuid as Former member when members loaded', () => {
    expect(formatAuditActor('22222222-2222-2222-2222-222222222222', map, true)).toBe(
      'Former member',
    );
  });

  it('shows placeholder while members are loading', () => {
    expect(formatAuditActor(MEMBER.user_id, new Map(), false)).toBe('…');
  });
});
