/** The issue a shortcut such as `I` or `A` applies to: the focused list/board row, otherwise the
 * issue whose page is open (`/o/:org/issues/KEY`). */
export function targetIssueKey(pathname: string, active: Element | null): string | null {
  const row = active?.closest<HTMLElement>('[data-issue-row]');
  if (row?.dataset.issueKey) return row.dataset.issueKey;
  const match = /^\/o\/[^/]+\/issues\/([A-Za-z][A-Za-z0-9]*-\d+)/.exec(pathname);
  return match?.[1]?.toUpperCase() ?? null;
}

/** Project key part of an issue key (`WEB-12` -> `WEB`). */
export function projectOf(issueKey: string): string {
  return issueKey.slice(0, issueKey.lastIndexOf('-'));
}

/** Moves focus to the first card of the next/previous board column (or its first button when
 * the column is empty). Returns false when there is no column to move to. */
export function focusColumn(delta: 1 | -1, root: Document = document): boolean {
  const columns = Array.from(root.querySelectorAll<HTMLElement>('[data-board-column]'));
  if (columns.length === 0) return false;
  const active = root.activeElement;
  const current = columns.findIndex((column) => column.contains(active));
  const next = current < 0 ? (delta > 0 ? 0 : columns.length - 1) : current + delta;
  const column = columns[next];
  if (!column) return false;
  const target =
    column.querySelector<HTMLElement>('[data-issue-row] a[href*="/issues/"]') ??
    column.querySelector<HTMLElement>('button');
  target?.focus();
  column.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  return true;
}

/** Navigates to the Nth link of the project tabs (1 = first tab), as they are shown. */
export function projectTabLink(index: number, root: Document = document): HTMLElement | null {
  const links = root.querySelectorAll<HTMLElement>('nav[aria-label="Project"] a');
  return links[index - 1] ?? null;
}
