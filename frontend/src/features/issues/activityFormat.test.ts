import { describe, expect, it } from 'vitest';

import { describeIssueActivity } from './activityFormat';

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
});
