import type { Notification } from '../../lib/api/types';

import { groupNotifications, notificationHref } from './notificationGroups';

const make = (id: string, created_at: string, payload: Record<string, unknown> = {}) =>
  ({
    id,
    type: 'issue_commented',
    issue_key: 'WEB-1',
    actor: { id: 'u', display_name: 'Bob' },
    payload,
    read: false,
    created_at,
  }) as Notification;

describe('groupNotifications', () => {
  const now = new Date(2026, 9, 30, 15, 0, 0);
  it('splits today from earlier and drops empty groups', () => {
    const items = [
      make('a', new Date(2026, 9, 30, 9, 0).toISOString()),
      make('b', new Date(2026, 9, 29, 23, 0).toISOString()),
    ];
    const groups = groupNotifications(items, now);
    expect(groups.map((g) => [g.label, g.items.map((i) => i.id)])).toEqual([
      ['Today', ['a']],
      ['Earlier', ['b']],
    ]);
    expect(groupNotifications([items[1] as Notification], now).map((g) => g.label)).toEqual([
      'Earlier',
    ]);
    expect(groupNotifications([], now)).toEqual([]);
  });
});

describe('notificationHref', () => {
  it('deep links to the comment when the payload has one', () => {
    expect(notificationHref('acme', make('a', '2026-10-30T00:00:00Z', { comment_id: 'c9' }))).toBe(
      '/o/acme/issues/WEB-1#comment-c9',
    );
    expect(notificationHref('acme', make('a', '2026-10-30T00:00:00Z'))).toBe(
      '/o/acme/issues/WEB-1',
    );
  });
});
