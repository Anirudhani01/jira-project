import { describe, expect, it } from 'vitest';

import {
  createdTypeOf,
  describeIssueActivity,
  sprintChangeOf,
  statusChangeOf,
} from './activityFormat';

describe('describeIssueActivity', () => {
  it('formats common actions', () => {
    expect(
      describeIssueActivity({
        id: 1,
        actor: null,
        action: 'created',
        field: null,
        old_value: null,
        new_value: null,
        created_at: '2026-10-30T00:00:00Z',
      }),
    ).toBe('created this issue');
    expect(
      describeIssueActivity({
        id: 2,
        actor: null,
        action: 'updated',
        field: 'summary',
        old_value: 'a',
        new_value: 'b',
        created_at: '2026-10-30T00:00:00Z',
      }),
    ).toBe('updated summary');
  });

  const entry = (
    action: string,
    field: string | null,
    old_value: unknown,
    new_value: unknown,
  ): Parameters<typeof describeIssueActivity>[0] => ({
    id: 3,
    actor: null,
    action,
    field,
    old_value,
    new_value,
    created_at: '2026-10-30T00:00:00Z',
  });

  it('says which status an issue moved from and to', () => {
    expect(
      describeIssueActivity(
        entry(
          'transitioned',
          'status',
          { id: 's1', name: 'To Do' },
          { id: 's2', name: 'In Progress' },
        ),
      ),
    ).toBe('changed status from To Do to In Progress');
    expect(
      describeIssueActivity(entry('updated', 'status', null, { id: 's2', name: 'Done' })),
    ).toBe('changed status to Done');
  });

  it('falls back to plain wording when the names were not recorded', () => {
    expect(describeIssueActivity(entry('transitioned', 'status', null, null))).toBe(
      'changed status',
    );
    expect(describeIssueActivity(entry('transitioned', 'status', 'x', 42))).toBe('changed status');
  });

  it('describes sprint changes', () => {
    const s1 = { id: 'a', name: 'Sprint 1' };
    const s2 = { id: 'b', name: 'Sprint 2' };
    expect(describeIssueActivity(entry('sprint_changed', 'sprint', null, s1))).toBe(
      'added to Sprint 1',
    );
    expect(describeIssueActivity(entry('sprint_changed', 'sprint', s1, s2))).toBe(
      'moved from Sprint 1 to Sprint 2',
    );
    expect(describeIssueActivity(entry('sprint_changed', 'sprint', s1, null))).toBe(
      'removed from Sprint 1',
    );
    expect(describeIssueActivity(entry('sprint_changed', 'sprint', null, null))).toBe(
      'sprint changed',
    );
  });

  it('exposes the structured parts the activity list colours', () => {
    const a = { id: 'a', name: 'Sprint 1' };
    expect(
      statusChangeOf(
        entry('transitioned', 'status', { id: 's1', name: 'To Do' }, { id: 's2', name: 'Done' }),
      ),
    ).toEqual({ from: { id: 's1', name: 'To Do' }, to: { id: 's2', name: 'Done' } });
    expect(statusChangeOf(entry('transitioned', 'status', null, null))).toBeNull();
    expect(statusChangeOf(entry('created', null, null, null))).toBeNull();
    expect(sprintChangeOf(entry('sprint_changed', 'sprint', null, a))).toEqual({
      from: null,
      to: 'Sprint 1',
    });
    expect(sprintChangeOf(entry('sprint_changed', 'sprint', null, null))).toBeNull();
    expect(createdTypeOf(entry('created', null, null, { type: { id: 't', name: 'Task' } }))).toBe(
      'Task',
    );
    expect(createdTypeOf(entry('created', null, null, null))).toBeNull();
  });
});
