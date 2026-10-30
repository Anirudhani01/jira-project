/** Server-supported issue list sort values (PR 8). */
export type IssueListSort =
  | '-updated_at'
  | 'updated_at'
  | '-created_at'
  | 'created_at'
  | '-key'
  | 'key'
  | '-priority'
  | 'priority'
  | '-status'
  | 'status';

export const DEFAULT_ISSUE_LIST_SORT: IssueListSort = '-updated_at';

export type IssueListSortField = 'key' | 'priority' | 'status';

export function isIssueListSort(value: string | null): value is IssueListSort {
  if (!value) return false;
  return (
    [
      '-updated_at',
      'updated_at',
      '-created_at',
      'created_at',
      '-key',
      'key',
      '-priority',
      'priority',
      '-status',
      'status',
    ] as const
  ).includes(value as IssueListSort);
}

/** Toggle column sort: off → desc → asc → desc. */
export function nextIssueListSort(
  current: IssueListSort,
  field: IssueListSortField,
): IssueListSort {
  const desc = `-${field}` as IssueListSort;
  const asc = field as IssueListSort;
  if (current === desc) return asc;
  return desc;
}

export function sortIndicator(current: IssueListSort, field: IssueListSortField): string | null {
  if (current === `-${field}`) return '↓';
  if (current === field) return '↑';
  return null;
}
