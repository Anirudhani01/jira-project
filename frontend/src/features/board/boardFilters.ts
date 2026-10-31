import type { Board, Issue } from '../../lib/api/types';

export interface BoardFilters {
  q: string;
  mine: boolean;
  assignees: string[];
  typeId: string;
  labelId: string;
}

export const BOARD_FILTER_KEYS = ['q', 'mine', 'assignee', 'type', 'label'] as const;

export function parseBoardFilters(search: URLSearchParams): BoardFilters {
  const assigneeRaw = search.get('assignee') ?? '';
  return {
    q: (search.get('q') ?? '').trim(),
    mine: search.get('mine') === '1',
    assignees: assigneeRaw
      ? assigneeRaw
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : [],
    typeId: search.get('type') ?? '',
    labelId: search.get('label') ?? '',
  };
}

export function writeBoardFilters(search: URLSearchParams, filters: BoardFilters): URLSearchParams {
  const next = new URLSearchParams(search);
  if (filters.q) next.set('q', filters.q);
  else next.delete('q');
  if (filters.mine) next.set('mine', '1');
  else next.delete('mine');
  if (filters.assignees.length) next.set('assignee', filters.assignees.join(','));
  else next.delete('assignee');
  if (filters.typeId) next.set('type', filters.typeId);
  else next.delete('type');
  if (filters.labelId) next.set('label', filters.labelId);
  else next.delete('label');
  return next;
}

export function boardFiltersActive(filters: BoardFilters): boolean {
  return Boolean(
    filters.q || filters.mine || filters.assignees.length || filters.typeId || filters.labelId,
  );
}

export function boardNonQueryFiltersActive(filters: BoardFilters): boolean {
  return Boolean(filters.mine || filters.assignees.length || filters.typeId || filters.labelId);
}

/** Clears quick filters but keeps the board search query (`q`). */
export function resetBoardFiltersPreservingQuery(search: URLSearchParams): URLSearchParams {
  const filters = parseBoardFilters(search);
  return writeBoardFilters(search, {
    ...filters,
    mine: false,
    assignees: [],
    typeId: '',
    labelId: '',
  });
}

export function clearBoardSearchQuery(search: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(search);
  next.delete('q');
  return next;
}

/** Client-side quick filters on the ≤500 cards already loaded on the board. */
export function matchesBoardFilters(
  issue: Issue,
  filters: BoardFilters,
  currentUserId?: string,
): boolean {
  if (filters.q) {
    const needle = filters.q.toLowerCase();
    const hay = `${issue.key} ${issue.summary}`.toLowerCase();
    if (!hay.includes(needle)) return false;
  }
  if (filters.mine) {
    if (!currentUserId || issue.assignee?.id !== currentUserId) return false;
  }
  if (filters.assignees.length) {
    const id = issue.assignee?.id;
    if (!id || !filters.assignees.includes(id)) return false;
  }
  if (filters.typeId && issue.type.id !== filters.typeId) return false;
  if (filters.labelId && !issue.labels.some((l) => l.id === filters.labelId)) return false;
  return true;
}

export interface BoardFilterMeta {
  assignees: { id: string; name: string }[];
  types: { id: string; name: string }[];
  labels: { id: string; name: string; color: string }[];
}

export function collectBoardFilterMeta(board: Board): BoardFilterMeta {
  const assigneeMap = new Map<string, string>();
  const typeMap = new Map<string, string>();
  const labelMap = new Map<string, { name: string; color: string }>();
  for (const column of board.columns) {
    for (const issue of column.issues) {
      if (issue.assignee) assigneeMap.set(issue.assignee.id, issue.assignee.display_name);
      typeMap.set(issue.type.id, issue.type.name);
      for (const label of issue.labels) {
        labelMap.set(label.id, { name: label.name, color: label.color });
      }
    }
  }
  return {
    assignees: [...assigneeMap.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    types: [...typeMap.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    labels: [...labelMap.entries()]
      .map(([id, meta]) => ({ id, name: meta.name, color: meta.color }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export function filterBoardIssues(
  board: Board,
  filters: BoardFilters,
  currentUserId?: string,
): Board {
  return {
    ...board,
    columns: board.columns.map((column) => ({
      ...column,
      issues: column.issues.filter((issue) => matchesBoardFilters(issue, filters, currentUserId)),
    })),
  };
}
