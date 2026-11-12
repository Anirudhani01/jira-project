import { describeAuditEvent } from './formatAuditActivity';

describe('describeAuditEvent', () => {
  it('uses member display names when available', () => {
    const members = new Map([['u1', 'Alex Kim']]);
    const text = describeAuditEvent(
      {
        id: 1,
        action: 'project.created',
        actor_user_id: 'u1',
        target_type: 'project',
        target_id: 'SHOP',
        outcome: 'success',
        ip: null,
        user_agent: null,
        request_id: null,
        metadata: {},
        created_at: '2026-10-30T00:00:00Z',
      },
      members,
    );
    expect(text).toContain('Alex Kim');
    expect(text).toContain('project created');
  });

  const base = {
    id: 2,
    action: 'sprint.started',
    actor_user_id: 'u1',
    target_type: 'sprint',
    target_id: 'd768d9f3-f36f-4137-88e5-d63ca94459f5',
    outcome: 'success',
    ip: null,
    user_agent: null,
    request_id: null,
    metadata: {},
    created_at: '2026-10-30T00:00:00Z',
  } as const;
  const members = new Map([['u1', 'Alex Kim']]);

  it('never prints a raw UUID', () => {
    expect(describeAuditEvent(base, members)).toBe('Alex Kim sprint started');
  });

  it('names the thing from the event metadata', () => {
    const text = describeAuditEvent(
      { ...base, metadata: { project: 'SHOP', name: 'Sprint 1' } },
      members,
    );
    expect(text).toBe('Alex Kim sprint started (Sprint 1)');
  });
});
