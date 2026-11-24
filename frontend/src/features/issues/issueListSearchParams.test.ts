import { describe, expect, it } from 'vitest';

import {
  applySavedParams,
  clearIssueListFiltersPreservingQuery,
  clearIssueListQuery,
  issueListFiltersActive,
  filtersToParams,
  issueListNonQueryFiltersActive,
  savedParamsMatch,
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

  describe('saved filters', () => {
    it('filtersToParams keeps only filters, search and a non-default sort', () => {
      const search = new URLSearchParams('type=1&q=%20login%20&sort=-key&foo=bar&tester=me');
      expect(filtersToParams(search)).toEqual({
        type: '1',
        q: 'login',
        sort: '-key',
        tester: 'me',
      });
      expect(filtersToParams(new URLSearchParams('foo=bar'))).toEqual({});
    });

    it('applySavedParams replaces filters and keeps unrelated params', () => {
      const search = new URLSearchParams('type=1&q=old&sort=-key&foo=bar');
      const next = applySavedParams(search, { status_category: 'todo', tester: 'me' });
      expect(next.get('status_category')).toBe('todo');
      expect(next.get('tester')).toBe('me');
      expect(next.get('type')).toBeNull();
      expect(next.get('q')).toBeNull();
      expect(next.get('sort')).toBeNull();
      expect(next.get('foo')).toBe('bar');
    });

    it('a saved set round-trips through the URL', () => {
      const saved = { type: 't1', assignee: 'me', q: 'login', sort: '-key' };
      const search = applySavedParams(new URLSearchParams('foo=bar'), saved);
      expect(filtersToParams(search)).toEqual(saved);
      expect(savedParamsMatch(search, saved)).toBe(true);
    });

    it('savedParamsMatch is exact', () => {
      const saved = { type: 't1' };
      expect(savedParamsMatch(new URLSearchParams('type=t1&foo=bar'), saved)).toBe(true);
      expect(savedParamsMatch(new URLSearchParams('type=t1&assignee=me'), saved)).toBe(false);
      expect(savedParamsMatch(new URLSearchParams('type=t2'), saved)).toBe(false);
      expect(savedParamsMatch(new URLSearchParams(''), saved)).toBe(false);
    });
  });
});
