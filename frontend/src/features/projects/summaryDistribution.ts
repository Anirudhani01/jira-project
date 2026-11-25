import type { ProjectIssueSummary } from '../../lib/api/types';

export type StatusCategory = 'todo' | 'in_progress' | 'done';
export type StatusCountRow = ProjectIssueSummary['by_status'][number];

export const CATEGORY_ORDER: readonly StatusCategory[] = ['todo', 'in_progress', 'done'];

export const CATEGORY_LABEL: Record<StatusCategory, string> = {
  todo: 'To do',
  in_progress: 'In progress',
  done: 'Done',
};

/** The chart colour of each category: the status hues, re-stepped per theme for the bar
 * (see the `--chart-*` tokens in index.css). */
export const CATEGORY_COLOR: Record<StatusCategory, string> = {
  todo: 'var(--chart-todo)',
  in_progress: 'var(--chart-in-progress)',
  done: 'var(--chart-done)',
};

export interface CategoryGroup {
  category: StatusCategory;
  label: string;
  count: number;
  statuses: StatusCountRow[];
}

/** Statuses grouped by category, in a fixed To do / In progress / Done order. A category the
 * workflow has no status for is left out. */
export function groupByCategory(statuses: StatusCountRow[]): CategoryGroup[] {
  return CATEGORY_ORDER.flatMap((category) => {
    const rows = statuses.filter((status) => status.category === category);
    if (rows.length === 0) return [];
    return [
      {
        category,
        label: CATEGORY_LABEL[category],
        count: rows.reduce((sum, row) => sum + row.count, 0),
        statuses: rows,
      },
    ];
  });
}

/** "<1%" for a tiny non-zero share, whole numbers otherwise, "—" when there is nothing to share. */
export function sharePercentLabel(count: number, total: number): string {
  if (total <= 0) return '—';
  if (count <= 0) return '0%';
  const percent = (count / total) * 100;
  if (percent < 1) return '<1%';
  return `${String(Math.round(percent))}%`;
}

/** Bar segment widths in percent. A non-zero segment is never narrower than `minPercent`, so a
 * 1-in-500 share stays visible; the room it takes is removed from the larger segments. */
export function segmentWidths(counts: number[], minPercent = 2): number[] {
  const total = counts.reduce((sum, count) => sum + count, 0);
  if (total <= 0) return counts.map(() => 0);
  const raw = counts.map((count) => (count / total) * 100);
  const small = raw.map((width) => width > 0 && width < minPercent);
  const reserved = small.filter(Boolean).length * minPercent;
  const largeSum = raw.reduce((sum, width, index) => (small[index] ? sum : sum + width), 0);
  const room = 100 - reserved;
  return raw.map((width, index) => {
    if (width === 0) return 0;
    if (small[index]) return minPercent;
    return largeSum > 0 ? (width / largeSum) * room : 0;
  });
}

/** The text alternative of the bar, e.g. "12 issues: 5 to do, 3 in progress, 4 done". */
export function summaryText(groups: CategoryGroup[], total: number): string {
  const noun = total === 1 ? 'issue' : 'issues';
  const parts = groups.map((group) => `${String(group.count)} ${group.label.toLowerCase()}`);
  return `${String(total)} ${noun}: ${parts.join(', ')}`;
}

export interface BreakdownRow {
  id: string;
  name: string;
  count: number;
  active: boolean;
}

/** Largest first; equal counts keep alphabetical order, so the list never reshuffles. */
export function rankByCount(rows: BreakdownRow[]): BreakdownRow[] {
  return [...rows].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/** Bar width in percent of the largest row, never below `minPercent` for a non-zero count. */
export function barWidth(count: number, max: number, minPercent = 2): number {
  if (count <= 0 || max <= 0) return 0;
  return Math.max(minPercent, (count / max) * 100);
}

/** The issue list filtered the way a count on the Summary page was computed. */
export function issueListHref(
  org: string,
  project: string,
  filter: Record<string, string> = {},
): string {
  const search = new URLSearchParams(filter).toString();
  return `/o/${org}/p/${project}/issues${search ? `?${search}` : ''}`;
}

export function formatCount(value: number, locale: string): string {
  try {
    return new Intl.NumberFormat(locale).format(value);
  } catch {
    return String(value);
  }
}
