import { beforeEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_ISSUE_LIST_COLUMNS,
  issueListTableColumnCount,
  readIssueListColumns,
  writeIssueListColumns,
} from './issueListColumns';

describe('issueListColumns', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults optional quarters to visible', () => {
    expect(readIssueListColumns('demo', 'mobile')).toEqual(DEFAULT_ISSUE_LIST_COLUMNS);
  });

  it('counts visible table columns from fixed plus optional toggles', () => {
    expect(issueListTableColumnCount(DEFAULT_ISSUE_LIST_COLUMNS)).toBe(5);
    expect(issueListTableColumnCount({ status: false, assignee: false })).toBe(3);
    expect(issueListTableColumnCount({ status: true, assignee: false })).toBe(4);
  });

  it('ignores legacy type/priority keys in storage', () => {
    localStorage.setItem(
      'jira.issues.columns.demo.MOBILE',
      JSON.stringify({ type: false, priority: false, status: true, assignee: true }),
    );
    expect(readIssueListColumns('demo', 'mobile')).toEqual({
      status: true,
      assignee: true,
      labels: false,
      updated: false,
    });
  });

  it('persists toggles per org and project', () => {
    writeIssueListColumns('demo', 'mobile', {
      status: true,
      assignee: false,
    });
    expect(readIssueListColumns('demo', 'mobile')).toMatchObject({
      assignee: false,
      status: true,
    });
    expect(readIssueListColumns('demo', 'shop').assignee).toBe(true);
  });
});
