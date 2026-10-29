import type { Comment, IssueActivity } from '../../lib/api/types';

/** Comments + field-change activity, merged into one chronological timeline (plan M8 AC).
 *
 * - Ordering is by `created_at`; ties at the exact same instant are broken by a fixed,
 *   explicit rule -- activity before comments -- not by relying on `Array.prototype.sort`
 *   being stable (it is, in every engine this app targets, but encoding the rule in the
 *   comparator itself makes the behavior deterministic by construction, not by accident,
 *   and keeps it correct even if the inputs arrive in a different order).
 * - Deduplicated by a kind-qualified id (`activity-<id>` / `comment-<id>`): activity ids
 *   and comment ids are drawn from different id spaces (`number` vs UUID string), so a
 *   plain id collision across kinds is not possible, but repeated pages (e.g. a refetch
 *   that re-delivers an already-seen page) must not produce duplicate entries. The first
 *   occurrence of a given key wins.
 */

export type TimelineEntry =
  | { kind: 'activity'; at: string; key: string; activity: IssueActivity }
  | { kind: 'comment'; at: string; key: string; comment: Comment };

function compareEntries(a: TimelineEntry, b: TimelineEntry): number {
  const byTime = a.at.localeCompare(b.at);
  if (byTime !== 0) return byTime;
  if (a.kind === b.kind) return 0;
  return a.kind === 'activity' ? -1 : 1;
}

export function mergeTimeline(activity: IssueActivity[], comments: Comment[]): TimelineEntry[] {
  const seen = new Set<string>();
  const entries: TimelineEntry[] = [];
  for (const item of activity) {
    const key = `activity-${String(item.id)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({ kind: 'activity', at: item.created_at, key, activity: item });
  }
  for (const comment of comments) {
    const key = `comment-${comment.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({ kind: 'comment', at: comment.created_at, key, comment });
  }
  return entries.sort(compareEntries);
}
