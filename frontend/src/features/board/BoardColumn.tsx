import { useDroppable } from '@dnd-kit/core';
import { Plus } from 'lucide-react';

import { Button } from '../../components/ui/Button';
import { Count } from '../../components/ui/Badge';
import { cn } from '../../lib/cn';
import type { BoardColumn as BoardColumnType, Issue } from '../../lib/api/types';

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

export function BoardColumnView({
  column,
  sourceColumn,
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
  dimmed: boolean;
  filteredCount: number;
  filtersActive: boolean;
  canCreate: boolean;
  onCreate: () => void;
} & Omit<IssueCardProps, 'card'>) {
  const { setNodeRef, isOver } = useDroppable({
    id: `${COLUMN_PREFIX}${column.id}`,
    disabled: dimmed,
  });

  const countLabel = filtersActive
    ? `${String(filteredCount)} of ${String(sourceColumn.count)}`
    : String(sourceColumn.count);

  return (
    <section
      ref={setNodeRef}
      aria-labelledby={`col-${column.id}`}
      className={cn(
        'flex w-[17.5rem] shrink-0 flex-col rounded-lg border border-line bg-surface-2/80',
        dimmed && 'opacity-40',
        isOver && !dimmed && 'ring-2 ring-accent/40',
      )}
    >
      <header className="space-y-2 border-b border-line px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <h2 id={`col-${column.id}`} className="truncate text-sm font-semibold text-fg">
            {column.name}
          </h2>
          <Count>{countLabel}</Count>
        </div>
        <WipBar
          count={sourceColumn.count}
          limit={sourceColumn.wip_limit}
          over={sourceColumn.over_wip_limit}
        />
      </header>
      <ul className="flex min-h-[12rem] flex-1 flex-col gap-2 overflow-y-auto p-2">
        {column.issues.length === 0 ? (
          <li className="pointer-events-none flex flex-1 items-center justify-center rounded-md border border-dashed border-line-strong px-3 py-8 text-center text-xs text-fg-muted">
            {filtersActive ? 'No issues match filters' : 'Drop issues here'}
          </li>
        ) : (
          column.issues.map((card: Issue) => (
            <IssueCard key={card.key} card={card} {...cardProps} />
          ))
        )}
      </ul>
      {canCreate ? (
        <footer className="border-t border-line p-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-full justify-start text-fg-muted"
            onClick={onCreate}
          >
            <Plus className="size-4" aria-hidden="true" />
            Create
          </Button>
        </footer>
      ) : null}
    </section>
  );
}

export { COLUMN_PREFIX };
