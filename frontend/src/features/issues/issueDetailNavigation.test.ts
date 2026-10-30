import { describe, expect, it } from 'vitest';

import {
  isIssueDetailPath,
  issueDetailLinkContext,
  issueDetailLinkProps,
  issueDetailModalState,
  issueDetailPath,
  readIssueDetailModalState,
} from './issueDetailNavigation';

const loc = (pathname: string, state: unknown = null) =>
  ({
    pathname,
    search: '',
    hash: '',
    state,
    key: 'default',
  }) as const;

describe('issueDetailNavigation', () => {
  it('builds issue paths', () => {
    expect(issueDetailPath('demo', 'MOB-1')).toBe('/o/demo/issues/MOB-1');
  });

  it('detects issue detail paths', () => {
    expect(isIssueDetailPath('/o/demo/issues/MOB-1')).toBe(true);
    expect(isIssueDetailPath('/o/demo/p/MOB/board')).toBe(false);
  });

  it('reads modal state from location state', () => {
    const board = loc('/o/demo/p/MOB/board');
    const state = issueDetailModalState(board);
    expect(readIssueDetailModalState(state)).toEqual({ backgroundLocation: board });
    expect(readIssueDetailModalState(null)).toBeNull();
  });

  it('keeps board as link context when navigating inside modal', () => {
    const board = loc('/o/demo/p/MOB/board');
    const issue = loc('/o/demo/issues/MOB-1', issueDetailModalState(board));
    expect(issueDetailLinkContext(issue)).toEqual(board);
  });

  it('link props preserve modal background', () => {
    const board = loc('/o/demo/p/MOB/board');
    const props = issueDetailLinkProps('demo', 'MOB-2', board);
    expect(props.to).toBe('/o/demo/issues/MOB-2');
    expect(props.state.backgroundLocation).toEqual(board);
  });
});
