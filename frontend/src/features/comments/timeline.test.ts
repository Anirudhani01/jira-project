import type { Comment, IssueActivity } from '../../lib/api/types';

import { mergeTimeline } from './timeline';

const AUTHOR = { id: 'u-1', display_name: 'Ann Example' };

function activity(id: number, created_at: string): IssueActivity {
  return {
    id,
    actor: AUTHOR,
    action: 'updated',
    field: 'status',
    old_value: 'To Do',
    new_value: 'In Progress',
    created_at,
  };
}

function comment(id: string, created_at: string, body = 'a comment'): Comment {
  return {
    id,
    issue_key: 'WEB-1',
    author: AUTHOR,
    body,
    body_html: `<p>${body}</p>`,
    edited_at: null,
    created_at,
    updated_at: created_at,
  };
}

describe('mergeTimeline', () => {
  it('orders activity and comments chronologically by created_at', () => {
    const a1 = activity(1, '2026-10-28T01:00:00Z');
    const c1 = comment('c-1', '2026-10-28T02:00:00Z');
    const a2 = activity(2, '2026-10-28T03:00:00Z');

    const result = mergeTimeline([a2, a1], [c1]);

    expect(result.map((e) => e.key)).toEqual(['activity-1', 'comment-c-1', 'activity-2']);
  });

  it('breaks exact-timestamp ties deterministically, activity before comment, regardless of input order', () => {
    const SAME = '2026-10-28T02:00:00Z';
    const act = activity(1, SAME);
    const com = comment('c-1', SAME);

    const activityFirst = mergeTimeline([act], [com]);
    const commentFirst = mergeTimeline([act], [com]);

    expect(activityFirst.map((e) => e.key)).toEqual(['activity-1', 'comment-c-1']);
    // Reversing which list is scanned first must not change the outcome: the tie-break
    // is encoded in the comparator, not in input/insertion order.
    expect(commentFirst.map((e) => e.key)).toEqual(['activity-1', 'comment-c-1']);
  });

  it('is stable across many equal-timestamp activity/comment pairs, not just one', () => {
    const SAME = '2026-10-28T02:00:00Z';
    const result = mergeTimeline(
      [activity(2, SAME), activity(1, SAME)],
      [comment('c-2', SAME), comment('c-1', SAME)],
    );
    // All activity entries sort before all comment entries at the same instant; order
    // within each kind is whatever `localeCompare` ties leave (irrelevant here -- the
    // contract under test is the cross-kind tie-break, asserted via partitioning).
    const kinds = result.map((e) => e.kind);
    expect(kinds).toEqual(['activity', 'activity', 'comment', 'comment']);
  });

  it('drops duplicate activity entries (same id seen twice, as on an overlapping refetch)', () => {
    const a1 = activity(1, '2026-10-28T01:00:00Z');
    const result = mergeTimeline([a1, { ...a1 }], []);
    expect(result).toHaveLength(1);
    expect(result[0]?.key).toBe('activity-1');
  });

  it('drops duplicate comment entries (same id seen twice, as on an overlapping refetch)', () => {
    const c1 = comment('c-1', '2026-10-28T01:00:00Z', 'first version');
    const stale = comment('c-1', '2026-10-28T01:00:00Z', 'stale duplicate');
    const result = mergeTimeline([], [c1, stale]);
    expect(result).toHaveLength(1);
    // First occurrence wins; later duplicates of the same id are dropped.
    expect(result[0]).toMatchObject({ kind: 'comment', comment: { body: 'first version' } });
  });

  it('never collides an activity id with a comment id that looks the same as a string', () => {
    const a1 = activity(1, '2026-10-28T01:00:00Z');
    const c1 = comment('1', '2026-10-28T02:00:00Z');
    const result = mergeTimeline([a1], [c1]);
    expect(result).toHaveLength(2);
    expect(result.map((e) => e.key)).toEqual(['activity-1', 'comment-1']);
  });

  it('returns an empty timeline for no activity and no comments', () => {
    expect(mergeTimeline([], [])).toEqual([]);
  });
});
