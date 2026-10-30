import type { Board, BoardColumn } from '../../lib/api/types';

/** Visual column kind for board chrome (dot color). */
export type ColumnVisualKind = 'todo' | 'in_progress' | 'in_review' | 'done';

function statusNameLooksLikeReview(name: string): boolean {
  const n = name.toLowerCase();
  return n.includes('review') || n.includes('qa') || n.includes('verify');
}

function statusesForColumn(column: BoardColumn, board: Board) {
  const fromColumn = column.issues.map((issue) => issue.status);
  if (fromColumn.length) return fromColumn;

  const seen = new Map<string, (typeof fromColumn)[number]>();
  for (const col of board.columns) {
    for (const issue of col.issues) {
      if (column.status_ids.includes(issue.status.id) && !seen.has(issue.status.id)) {
        seen.set(issue.status.id, issue.status);
      }
    }
  }
  return [...seen.values()];
}

/** Map workflow status metadata to column dot colors (review inferred from status names). */
export function columnVisualKind(column: BoardColumn, board: Board): ColumnVisualKind {
  const statuses = statusesForColumn(column, board);

  if (statuses.length > 0) {
    const categories = new Set(statuses.map((s) => s.category));
    if (categories.size === 1 && categories.has('done')) return 'done';
    if (categories.size === 1 && categories.has('todo')) return 'todo';
    if (statuses.some((s) => statusNameLooksLikeReview(s.name))) return 'in_review';
    if (categories.has('in_progress') || categories.has('todo')) {
      if (statuses.every((s) => s.category === 'todo')) return 'todo';
      if (statuses.some((s) => statusNameLooksLikeReview(s.name))) return 'in_review';
      return 'in_progress';
    }
    return 'done';
  }

  const name = column.name.toLowerCase();
  if (name.includes('done')) return 'done';
  if (statusNameLooksLikeReview(column.name)) return 'in_review';
  if (name.includes('progress') || name.includes('doing')) return 'in_progress';
  return 'todo';
}

export function columnDotClassName(kind: ColumnVisualKind): string {
  return `board-col-dot board-col-dot--${kind}`;
}
