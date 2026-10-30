import { matchPath, type Location } from 'react-router';

/** When set, issue detail renders in a modal over `backgroundLocation`. */
export type IssueDetailLocationState = {
  backgroundLocation: Location;
};

export function issueDetailPath(org: string, issueKey: string): string {
  return `/o/${org}/issues/${issueKey}`;
}

export function issueDetailModalState(from: Location): IssueDetailLocationState {
  return { backgroundLocation: from };
}

/** Page to keep visible under the modal (board/list), even when linking from another issue in-modal. */
export function issueDetailLinkContext(from: Location): Location {
  return readIssueDetailModalState(from.state)?.backgroundLocation ?? from;
}

export function isIssueDetailPath(pathname: string): boolean {
  return matchPath({ path: '/o/:org/issues/:issueKey', end: true }, pathname) !== null;
}

export function readIssueDetailModalState(state: unknown): IssueDetailLocationState | null {
  if (!state || typeof state !== 'object') return null;
  if (!('backgroundLocation' in state)) return null;
  const bg = (state as IssueDetailLocationState).backgroundLocation;
  if (typeof bg.pathname !== 'string') return null;
  return { backgroundLocation: bg };
}

/** `Link` props for opening issue detail as a modal over the current page. */
export function issueDetailLinkProps(org: string, issueKey: string, from: Location) {
  return {
    to: issueDetailPath(org, issueKey),
    state: issueDetailModalState(issueDetailLinkContext(from)),
  } as const;
}
