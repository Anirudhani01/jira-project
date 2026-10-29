import type { Board, Issue } from '../../lib/api/types';

/** Where a card lands: the target status plus the neighbours the server ranks between
 * (`after` sits directly above the card, `before` directly below). */
export interface MovePlan {
  toStatusId: string;
  statusChanged: boolean;
  afterKey: string | null;
  beforeKey: string | null;
}

export function findCard(board: Board, key: string) {
  for (const [columnIndex, column] of board.columns.entries()) {
    const index = column.issues.findIndex((card) => card.key === key);
    if (index >= 0) return { columnIndex, index, card: column.issues[index] as Issue };
  }
  return null;
}

function reachable(board: Board, fromStatusId: string): Set<string> {
  return new Set(
    board.transitions
      .filter((t) => t.from_status_id === null || t.from_status_id === fromStatusId)
      .map((t) => t.to_status_id),
  );
}

/** The status a card gets when dropped on a column: its own when it already lives there,
 * otherwise the first column status the workflow allows. `null` = not a valid drop. */
export function targetStatus(board: Board, card: Issue, columnId: string): string | null {
  const column = board.columns.find((c) => c.id === columnId);
  if (!column) return null;
  if (column.status_ids.includes(card.status.id)) return card.status.id;
  const allowed = reachable(board, card.status.id);
  return column.status_ids.find((id) => allowed.has(id)) ?? null;
}

export function allowedColumnIds(board: Board, card: Issue): Set<string> {
  return new Set(
    board.columns.filter((c) => targetStatus(board, card, c.id) !== null).map((c) => c.id),
  );
}

/** `index` is the insert position among the target column's cards without the moved one. */
export function planMove(
  board: Board,
  key: string,
  columnId: string,
  index: number,
): MovePlan | null {
  const found = findCard(board, key);
  const column = board.columns.find((c) => c.id === columnId);
  if (!found || !column) return null;
  const toStatusId = targetStatus(board, found.card, columnId);
  if (toStatusId === null) return null;
  const others = column.issues.filter((card) => card.key !== key);
  const at = Math.max(0, Math.min(index, others.length));
  return {
    toStatusId,
    statusChanged: toStatusId !== found.card.status.id,
    afterKey: others[at - 1]?.key ?? null,
    beforeKey: others[at]?.key ?? null,
  };
}

/** Pure optimistic update: the board as it will look once the move succeeds. */
export function applyMove(board: Board, key: string, columnId: string, index: number): Board {
  const found = findCard(board, key);
  const plan = planMove(board, key, columnId, index);
  if (!found || !plan) return board;
  const moved: Issue = { ...found.card, status: { ...found.card.status, id: plan.toStatusId } };
  return {
    ...board,
    columns: board.columns.map((column) => {
      const without = column.issues.filter((card) => card.key !== key);
      const issues =
        column.id === columnId
          ? [
              ...without.slice(0, Math.max(0, Math.min(index, without.length))),
              moved,
              ...without.slice(Math.max(0, Math.min(index, without.length))),
            ]
          : without;
      const count = issues.length;
      return {
        ...column,
        issues,
        count,
        over_wip_limit: column.wip_limit !== null && count > column.wip_limit,
      };
    }),
  };
}
