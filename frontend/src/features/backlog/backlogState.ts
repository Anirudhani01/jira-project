import type { Issue } from '../../lib/api/types';

export type Density = 'default' | 'compact';

export interface BacklogFields {
  type: boolean;
  key: boolean;
  epic: boolean;
  version: boolean;
  labels: boolean;
  priority: boolean;
  assignee: boolean;
  status: boolean;
  points: boolean;
}

export const FIELD_LABELS: Record<keyof BacklogFields, string> = {
  type: 'Work type',
  key: 'Key',
  epic: 'Epic',
  version: 'Fix version',
  labels: 'Labels',
  priority: 'Priority',
  assignee: 'Assignee',
  status: 'Status',
  points: 'Story points',
};

export const DEFAULT_FIELDS: BacklogFields = {
  type: true,
  key: true,
  epic: true,
  version: true,
  labels: true,
  priority: true,
  assignee: true,
  status: true,
  points: true,
};

export interface StatusCounts {
  todo: number;
  in_progress: number;
  done: number;
}

/** Issue counts per status category (the lozenges in a sprint panel header). */
export function statusCounts(issues: readonly Issue[]): StatusCounts {
  const counts: StatusCounts = { todo: 0, in_progress: 0, done: 0 };
  for (const issue of issues) {
    const category = issue.status.category;
    if (category === 'done') counts.done += 1;
    else if (category === 'in_progress') counts.in_progress += 1;
    else counts.todo += 1;
  }
  return counts;
}

/** Issues still open (not in a done status); what completing a sprint moves. */
export function openCount(issues: readonly Issue[]): number {
  return issues.filter((issue) => issue.status.category !== 'done').length;
}

/** Quick filter: every word must match the key, summary, assignee, labels or parent key. */
export function filterIssues(issues: readonly Issue[], query: string): Issue[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...issues];
  return issues.filter((issue) => {
    const haystack = [
      issue.key,
      issue.summary,
      issue.assignee?.display_name ?? '',
      issue.parent?.key ?? '',
      ...issue.labels.map((label) => label.name),
    ]
      .join(' ')
      .toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

/** Keys from `anchor` to `target` (inclusive, either direction) in display order. */
export function rangeKeys(order: readonly string[], anchor: string, target: string): string[] {
  const from = order.indexOf(anchor);
  const to = order.indexOf(target);
  if (from < 0 || to < 0) return [target];
  const [start, end] = from <= to ? [from, to] : [to, from];
  return order.slice(start, end + 1);
}

/** Selection after a click: shift extends from the anchor; otherwise toggles one key. */
export function nextSelection(
  selected: readonly string[],
  key: string,
  options: { shift: boolean; anchor: string | null; order: readonly string[] },
): string[] {
  if (options.shift && options.anchor) {
    return [...new Set([...selected, ...rangeKeys(options.order, options.anchor, key)])];
  }
  return selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key];
}

/** Default dates for a new sprint: today (local) for two weeks, as `datetime-local` values. */
export function defaultSprintDates(now: Date = new Date()): { start: string; end: string } {
  const pad = (n: number) => String(n).padStart(2, '0');
  const local = (d: Date) =>
    `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const end = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  return { start: local(now), end: local(end) };
}

/** URL filter value: an epic key / version id, `none` for "without", or empty for no filter. */
export interface PlanFilter {
  epic: string;
  version: string;
}

export const NONE = 'none';

/** Keeps issues in the selected epic (parent key) and/or fix version. */
export function filterByPlan(issues: readonly Issue[], filter: PlanFilter): Issue[] {
  return issues.filter((issue) => {
    if (filter.epic) {
      const parent = issue.parent?.key ?? null;
      if (filter.epic === NONE ? parent !== null : parent !== filter.epic) return false;
    }
    if (filter.version) {
      const version = issue.fix_version?.id ?? null;
      if (filter.version === NONE ? version !== null : version !== filter.version) return false;
    }
    return true;
  });
}

/** Percentage (0-100, whole number) for a progress bar; 0 when there is nothing to do. */
export function percent(done: number, total: number): number {
  return total <= 0 ? 0 : Math.round((done / total) * 100);
}
