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
});
