import { DEFAULT_ISSUE_LIST_SORT, isIssueListSort, type IssueListSort } from './issueListSort';

export const ISSUE_LIST_FILTER_KEYS = [
  'status_category',
  'type',
  'priority',
  'assignee',
  'label',
  'sprint',
] as const;

export const ISSUE_LIST_QUERY_KEY = 'q' as const;

const SORT_PARAM = 'sort';

export function issueListSortActive(search: URLSearchParams): boolean {
  const sort = search.get(SORT_PARAM);
  return Boolean(sort && sort !== DEFAULT_ISSUE_LIST_SORT);
}

export function issueListQueryActive(search: URLSearchParams): boolean {
  return Boolean(search.get(ISSUE_LIST_QUERY_KEY)?.trim());
}

export function issueListNonQueryFiltersActive(search: URLSearchParams): boolean {
  return (
    issueListSortActive(search) || ISSUE_LIST_FILTER_KEYS.some((name) => Boolean(search.get(name)))
  );
}

export function issueListFiltersActive(search: URLSearchParams): boolean {
  return issueListQueryActive(search) || issueListNonQueryFiltersActive(search);
}

export function readIssueListSort(search: URLSearchParams): IssueListSort {
  const raw = search.get(SORT_PARAM);
  return raw && isIssueListSort(raw) ? raw : DEFAULT_ISSUE_LIST_SORT;
}

export function clearIssueListFiltersPreservingQuery(search: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(search);
  for (const name of ISSUE_LIST_FILTER_KEYS) next.delete(name);
  next.delete(SORT_PARAM);
  return next;
}

export function clearIssueListQuery(search: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(search);
  next.delete(ISSUE_LIST_QUERY_KEY);
  return next;
}
