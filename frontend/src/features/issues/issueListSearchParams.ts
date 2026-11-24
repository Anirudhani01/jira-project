import { DEFAULT_ISSUE_LIST_SORT, isIssueListSort, type IssueListSort } from './issueListSort';

export const ISSUE_LIST_FILTER_KEYS = [
  'status_category',
  'type',
  'priority',
  'assignee',
  'tester',
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

/** The URL parameters a saved filter stores: every filter, the search text and the sort. */
export const SAVED_FILTER_KEYS = [
  ...ISSUE_LIST_FILTER_KEYS,
  ISSUE_LIST_QUERY_KEY,
  SORT_PARAM,
] as const;

/** The saved-filter parameters of the current URL; the default sort is not stored. */
export function filtersToParams(search: URLSearchParams): Record<string, string> {
  const params: Record<string, string> = {};
  for (const name of SAVED_FILTER_KEYS) {
    const value = search.get(name)?.trim();
    if (!value || (name === SORT_PARAM && value === DEFAULT_ISSUE_LIST_SORT)) continue;
    params[name] = value;
  }
  return params;
}

/** Replaces the filters, search text and sort with a saved set; unrelated params stay. */
export function applySavedParams(
  search: URLSearchParams,
  params: Record<string, string>,
): URLSearchParams {
  const next = new URLSearchParams(search);
  for (const name of SAVED_FILTER_KEYS) next.delete(name);
  for (const name of SAVED_FILTER_KEYS) {
    const value = params[name];
    if (value) next.set(name, value);
  }
  return next;
}

/** True when the URL shows exactly this saved set (the default sort counts as no sort). */
export function savedParamsMatch(search: URLSearchParams, params: Record<string, string>): boolean {
  const current = filtersToParams(search);
  const saved = Object.fromEntries(Object.entries(params).filter(([, value]) => value));
  const names = new Set([...Object.keys(current), ...Object.keys(saved)]);
  return [...names].every((name) => current[name] === saved[name]);
}
