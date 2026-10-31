import { describe, expect, it } from 'vitest';

import {
  clearIssueListFiltersPreservingQuery,
  clearIssueListQuery,
  issueListFiltersActive,
  issueListNonQueryFiltersActive,
} from './issueListSearchParams';

describe('issueListSearchParams', () => {
  it('clearIssueListFiltersPreservingQuery keeps q and unrelated params', () => {
    const search = new URLSearchParams('q=login&status_category=todo&type=1&sort=-key&foo=bar');
    const next = clearIssueListFiltersPreservingQuery(search);
    expect(next.get('q')).toBe('login');
    expect(next.get('foo')).toBe('bar');
    expect(next.get('status_category')).toBeNull();
    expect(next.get('type')).toBeNull();
    expect(next.get('sort')).toBeNull();
  });

  it('clearIssueListQuery removes only q', () => {
    const search = new URLSearchParams('q=login&status_category=todo&foo=bar');
    const next = clearIssueListQuery(search);
    expect(next.get('q')).toBeNull();
    expect(next.get('status_category')).toBe('todo');
    expect(next.get('foo')).toBe('bar');
  });

  it('tracks query vs non-query filter activity', () => {
    expect(issueListFiltersActive(new URLSearchParams('q=abc'))).toBe(true);
    expect(issueListNonQueryFiltersActive(new URLSearchParams('q=abc'))).toBe(false);
    expect(issueListNonQueryFiltersActive(new URLSearchParams('type=1'))).toBe(true);
  });
});
