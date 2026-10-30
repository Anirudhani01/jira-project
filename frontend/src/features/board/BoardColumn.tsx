import { useDroppable } from '@dnd-kit/core';
import { CheckCircle2, FileText, MoreHorizontal, Plus } from 'lucide-react';

import { useBoardShell } from '../../app/shell/useBoardShell';
import { Count } from '../../components/ui/Badge';
import { Button, IconButton } from '../../components/ui/Button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../components/ui/Overlay';
import { cn } from '../../lib/cn';
import type { Board, BoardColumn as BoardColumnType, Issue } from '../../lib/api/types';

import { columnDotClassName, columnVisualKind } from './columnStatusStyle';
import { IssueCard, type IssueCardProps } from './IssueCard';

const COLUMN_PREFIX = 'column:';

function WipBar({ count, limit, over }: { count: number; limit: number | null; over: boolean }) {
  if (limit === null) return null;
  const ratio = limit > 0 ? Math.min(1, count / limit) : 0;
  const barTone = over ? 'bg-danger' : count >= limit ? 'bg-warning' : 'bg-accent/70';
  return (
    <div className="space-y-1">
      <div
        className="h-1.5 overflow-hidden rounded-full bg-surface-2"
        role="meter"
        aria-valuenow={count}
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-label={`Work in progress ${count} of ${limit}`}
      >
        <div
          className={cn('h-full rounded-full transition-all', barTone)}
          style={{ width: `${String(ratio * 100)}%` }}
        />
      </div>
      <p
        className={cn(
          'text-[11px] tabular-nums',
          over ? 'font-semibold text-danger' : 'text-fg-muted',
        )}
      >
        {count} / {limit}
        {over ? ' · over limit' : null}
      </p>
    </div>
  );
}

function BoardColumnEmpty({
  boardChrome,
  visualKind,
  hiddenByFilters,
  trulyEmpty,
}: {
  boardChrome: boolean;
  visualKind: ReturnType<typeof columnVisualKind>;
  hiddenByFilters: boolean;
  trulyEmpty: boolean;
}) {
  if (hiddenByFilters) {
    return (
      <li className="pointer-events-none flex flex-1 items-center justify-center rounded-md border border-dashed border-line-strong px-3 py-8 text-center text-xs text-fg-muted">
        No issues match filters
      </li>
    );
  }

  if (boardChrome && trulyEmpty && visualKind === 'in_review') {
    return (
      <li className="board-column-empty pointer-events-none flex flex-1 flex-col items-center justify-center gap-2 px-4 py-10 text-center">
        <FileText className="size-8 text-[var(--board-muted)] opacity-60" aria-hidden="true" />
        <p className="text-sm font-medium text-[var(--board-text)]">No issues in review</p>
        <p className="board-empty-hint max-w-[12rem] text-xs">
          Drag and drop issues here or create a new issue.
        </p>
      </li>
    );
  }

  if (boardChrome && trulyEmpty && visualKind === 'done') {
    return (
      <li className="board-column-empty pointer-events-none flex flex-1 flex-col items-center justify-center gap-2 px-4 py-10 text-center">
        <CheckCircle2 className="size-8 text-[var(--board-muted)] opacity-60" aria-hidden="true" />
        <p className="text-sm font-medium text-[var(--board-text)]">No completed issues</p>
        <p className="board-empty-hint max-w-[12rem] text-xs">
          Drag and drop issues here or create a new issue.
        </p>
      </li>
    );
  }

  return (
    <li
      className={cn(
        'pointer-events-none flex flex-1 items-center justify-center rounded-md border border-dashed px-3 py-8 text-center text-xs text-fg-muted',
        boardChrome ? 'board-empty-hint border-[var(--board-border)]' : 'border-line-strong',
      )}
    >
      Drop issues here
    </li>
  );
}

export function BoardColumnView({
  column,
  sourceColumn,
  boardData,
  dimmed,
  filteredCount,
  filtersActive,
  canCreate,
  onCreate,
  ...cardProps
}: {
  column: BoardColumnType;
  /** Original column from the server (WIP counts). */
  sourceColumn: BoardColumnType;
  boardData: Board;
  dimmed: boolean;
  filteredCount: number;
  filtersActive: boolean;
  canCreate: boolean;
  onCreate: () => void;
} & Omit<IssueCardProps, 'card'>) {
  const boardChrome = useBoardShell();
  const { setNodeRef, isOver } = useDroppable({
    id: `${COLUMN_PREFIX}${column.id}`,
    disabled: dimmed,
  });

  const visualKind = columnVisualKind(sourceColumn, boardData);
  const countLabel = filtersActive
    ? `${String(filteredCount)} of ${String(sourceColumn.count)}`
    : String(sourceColumn.count);
  const trulyEmpty = sourceColumn.count === 0;
  const hiddenByFilters = filtersActive && filteredCount === 0 && sourceColumn.count > 0;

  return (
    <section
      ref={setNodeRef}
      aria-labelledby={`col-${column.id}`}
      className={cn(
        'flex shrink-0 flex-col rounded-lg border border-line bg-surface-2/80',
        boardChrome
          ? 'board-column min-h-[28rem] min-w-0 flex-1 border-[var(--board-border)] bg-[var(--board-col-bg)]'
          : 'w-[17.5rem]',
        dimmed && 'opacity-40',
        isOver &&
          !dimmed &&
          (boardChrome ? 'ring-2 ring-[var(--board-accent)]/35' : 'ring-2 ring-accent/40'),
      )}
    >
      <header
        className={cn(
          'space-y-2 border-b border-line px-3 py-2.5',
          boardChrome && 'board-column-header border-[var(--board-border)] px-3 py-2.5',
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {boardChrome ? (
              <span className={columnDotClassName(visualKind)} aria-hidden="true" />
            ) : null}
            <h2
              id={`col-${column.id}`}
              className={cn(
                'truncate text-sm font-semibold text-fg',
                boardChrome && 'text-[var(--board-text)]',
              )}
            >
              {column.name}
            </h2>
            <Count className={cn(boardChrome && 'board-column-count shrink-0')}>{countLabel}</Count>
          </div>
          {boardChrome ? (
            <div className="flex shrink-0 items-center gap-0.5">
              {canCreate ? (
                <IconButton
                  label={`Add issue to ${column.name}`}
                  size="sm"
                  className="board-col-action text-[var(--board-accent)]"
                  onClick={onCreate}
                >
                  <Plus className="size-4" aria-hidden="true" />
                </IconButton>
              ) : null}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <IconButton
                    label={`Column actions for ${column.name}`}
                    size="sm"
                    className="board-col-action text-[var(--board-muted)]"
                  >
                    <MoreHorizontal className="size-4" aria-hidden="true" />
                  </IconButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {canCreate ? (
                    <DropdownMenuItem
                      onSelect={() => {
                        onCreate();
                      }}
                    >
                      Create issue
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuItem disabled>Column settings — not available yet</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ) : (
            <Count>{countLabel}</Count>
          )}
        </div>
        {!boardChrome ? (
          <WipBar
            count={sourceColumn.count}
            limit={sourceColumn.wip_limit}
            over={sourceColumn.over_wip_limit}
          />
        ) : sourceColumn.wip_limit !== null ? (
          <WipBar
            count={sourceColumn.count}
            limit={sourceColumn.wip_limit}
            over={sourceColumn.over_wip_limit}
          />
        ) : null}
      </header>
      <ul
        className={cn(
          'board-column-list flex min-h-[12rem] flex-1 flex-col gap-2 overflow-y-auto p-2',
          boardChrome && 'gap-2.5 p-3',
        )}
      >
        {column.issues.length === 0 ? (
          <BoardColumnEmpty
            boardChrome={boardChrome}
            visualKind={visualKind}
            hiddenByFilters={hiddenByFilters}
            trulyEmpty={trulyEmpty}
          />
        ) : (
          column.issues.map((card: Issue) => (
            <IssueCard key={card.key} card={card} {...cardProps} />
          ))
        )}
      </ul>
      {canCreate ? (
        <footer
          className={cn(
            'border-t border-line p-2',
            boardChrome && 'board-column-footer border-[var(--board-border)] p-2.5',
          )}
        >
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={cn(
              'w-full justify-center text-fg-muted',
              boardChrome &&
                'board-create-issue rounded-lg font-medium text-[var(--board-accent)] hover:bg-[var(--board-accent-soft)]',
            )}
            onClick={onCreate}
          >
            <Plus className="size-4" aria-hidden="true" />
            {boardChrome ? 'Create issue' : 'Create'}
          </Button>
        </footer>
      ) : null}
    </section>
  );
}

export { COLUMN_PREFIX };
