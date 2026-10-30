import { useCallback, useState } from 'react';

/** Always-visible issue table columns (Issue, Type, Priority). */
export const ISSUE_LIST_FIXED_COLUMN_COUNT = 3;

/** Optional columns in the issue table (Issue, Type, and Priority are always shown). */
export type IssueListColumnId = 'status' | 'assignee' | 'labels' | 'updated';

export const ISSUE_LIST_COLUMNS: { id: IssueListColumnId; label: string }[] = [
  { id: 'status', label: 'Status' },
  { id: 'assignee', label: 'Assignee' },
  { id: 'labels', label: 'Labels' },
  { id: 'updated', label: 'Updated' },
];

export type IssueListColumnVisibility = Record<IssueListColumnId, boolean>;

export const DEFAULT_ISSUE_LIST_COLUMNS: IssueListColumnVisibility = {
  status: true,
  assignee: true,
  labels: false,
  updated: false,
};

function storageKey(org: string, projectKey: string): string {
  return `jira.issues.columns.${org}.${projectKey.toUpperCase()}`;
}

function columnScope(org: string, projectKey: string): string {
  return `${org.toLowerCase()}::${projectKey.toUpperCase()}`;
}

export function readIssueListColumns(org: string, projectKey: string): IssueListColumnVisibility {
  try {
    const raw = localStorage.getItem(storageKey(org, projectKey));
    if (!raw) return { ...DEFAULT_ISSUE_LIST_COLUMNS };
    const parsed = JSON.parse(raw) as Partial<
      IssueListColumnVisibility & { type?: boolean; priority?: boolean }
    >;
    return {
      status: parsed.status ?? DEFAULT_ISSUE_LIST_COLUMNS.status,
      assignee: parsed.assignee ?? DEFAULT_ISSUE_LIST_COLUMNS.assignee,
      labels: parsed.labels ?? DEFAULT_ISSUE_LIST_COLUMNS.labels,
      updated: parsed.updated ?? DEFAULT_ISSUE_LIST_COLUMNS.updated,
    };
  } catch {
    return { ...DEFAULT_ISSUE_LIST_COLUMNS };
  }
}

export function issueListTableColumnCount(visibility: IssueListColumnVisibility): number {
  const optional = ISSUE_LIST_COLUMNS.filter((col) => visibility[col.id]).length;
  return ISSUE_LIST_FIXED_COLUMN_COUNT + optional;
}

export function writeIssueListColumns(
  org: string,
  projectKey: string,
  visibility: IssueListColumnVisibility,
): void {
  try {
    localStorage.setItem(storageKey(org, projectKey), JSON.stringify(visibility));
  } catch {
    /* storage unavailable */
  }
}

export function useIssueListColumns(org: string, projectKey: string) {
  const scope = columnScope(org, projectKey);
  const [byProject, setByProject] = useState<Record<string, IssueListColumnVisibility>>({});

  const visible = byProject[scope] ?? readIssueListColumns(org, projectKey);

  const apply = useCallback(
    (next: IssueListColumnVisibility) => {
      writeIssueListColumns(org, projectKey, next);
      setByProject((prev) => ({ ...prev, [scope]: next }));
    },
    [org, projectKey, scope],
  );

  const toggle = useCallback(
    (id: IssueListColumnId) => {
      apply({ ...visible, [id]: !visible[id] });
    },
    [apply, visible],
  );

  const setColumn = useCallback(
    (id: IssueListColumnId, on: boolean) => {
      if (visible[id] === on) return;
      apply({ ...visible, [id]: on });
    },
    [apply, visible],
  );

  const reset = useCallback(() => {
    apply({ ...DEFAULT_ISSUE_LIST_COLUMNS });
  }, [apply]);

  return { visible, toggle, setColumn, reset };
}
