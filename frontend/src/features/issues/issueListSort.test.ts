import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ISSUE_LIST_SORT,
  isIssueListSort,
  nextIssueListSort,
  sortIndicator,
} from './issueListSort';

describe('issueListSort', () => {
  it('recognizes server sort values', () => {
    expect(isIssueListSort('-key')).toBe(true);
    expect(isIssueListSort('nope')).toBe(false);
  });

  it('toggles sort desc then asc', () => {
    expect(nextIssueListSort(DEFAULT_ISSUE_LIST_SORT, 'key')).toBe('-key');
    expect(nextIssueListSort('-key', 'key')).toBe('key');
    expect(nextIssueListSort('key', 'key')).toBe('-key');
  });

  it('shows sort direction indicators', () => {
    expect(sortIndicator('-priority', 'priority')).toBe('↓');
    expect(sortIndicator('status', 'status')).toBe('↑');
    expect(sortIndicator('-updated_at', 'key')).toBeNull();
  });
});
