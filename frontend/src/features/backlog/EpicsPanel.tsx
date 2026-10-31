import { useDroppable } from '@dnd-kit/core';
import { Plus, Zap } from 'lucide-react';

import { Button } from '../../components/ui/Button';
import { ErrorState } from '../../components/ui/States';
import { Skeleton } from '../../components/ui/Card';
import { UxEmptyState } from '../../components/ux';
import { cn } from '../../lib/cn';
import type { Epic } from '../../lib/api/types';

import { NONE, percent } from './backlogState';
import { useEpics } from './planApi';

export function Progress({ done, total, label }: { done: number; total: number; label: string }) {
  const value = percent(done, total);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
      className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2"
    >
      <div className="h-full bg-success" style={{ width: `${String(value)}%` }} />
    </div>
  );
}

function Entry({
  id,
  active,
  onSelect,
  children,
}: {
  id: string;
  active: boolean;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <li ref={setNodeRef}>
      <button
        type="button"
        aria-pressed={active}
        onClick={onSelect}
        className={cn(
          'w-full rounded-md border px-2 py-1.5 text-left text-sm',
          active ? 'border-accent bg-accent-soft' : 'border-transparent hover:bg-surface-hover',
          isOver && 'ring-2 ring-accent',
        )}
      >
        {children}
      </button>
    </li>
  );
}

/** Backlog Epics panel: choose an epic to filter the backlog to its issues, or drop issues on
 * an epic to make it their parent. Done epics are hidden unless asked for. */
export function EpicsPanel({
  org,
  project,
  selected,
  onSelect,
  includeDone,
  onIncludeDone,
  canCreate,
  onCreateEpic,
}: {
  org: string;
  project: string;
  selected: string;
  onSelect: (value: string) => void;
  includeDone: boolean;
  onIncludeDone: (value: boolean) => void;
  canCreate: boolean;
  onCreateEpic: () => void;
}) {
  const epics = useEpics(org, project, includeDone);
  const toggle = (value: string) => {
    onSelect(selected === value ? '' : value);
  };
  return (
    <section aria-label="Epics" className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Epics</h2>
        {canCreate ? (
          <Button variant="secondary" size="sm" onClick={onCreateEpic}>
            <Plus className="size-4" aria-hidden="true" /> Create epic
          </Button>
        ) : null}
      </div>
      <label className="flex items-center gap-2 text-xs text-fg-muted">
        <input
          type="checkbox"
          checked={includeDone}
          onChange={(event) => {
            onIncludeDone(event.target.checked);
          }}
        />
        Show done epics
      </label>
      {epics.isPending ? (
        <div role="status" aria-label="Loading epics…" className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : epics.isError ? (
        <ErrorState error={epics.error} onRetry={() => void epics.refetch()} />
      ) : (
        <ul className="space-y-1">
          <Entry
            id="epic:all"
            active={selected === ''}
            onSelect={() => {
              onSelect('');
            }}
          >
            All issues
          </Entry>
          <Entry
            id={`epic:${NONE}`}
            active={selected === NONE}
            onSelect={() => {
              toggle(NONE);
            }}
          >
            Issues without epic
          </Entry>
          {epics.data.map((epic: Epic) => (
            <Entry
              key={epic.id}
              id={`epic:${epic.key}`}
              active={selected === epic.key}
              onSelect={() => {
                toggle(epic.key);
              }}
            >
              <span className="flex items-center gap-1.5">
                <Zap className="size-3.5 shrink-0 text-[var(--epic)]" aria-hidden="true" />
                <span className="truncate font-medium">{epic.summary}</span>
              </span>
              <span className="mt-0.5 flex items-center justify-between text-xs text-fg-muted">
                <span className="font-mono">{epic.key}</span>
                <span>
                  {epic.done}/{epic.total} done
                </span>
              </span>
              <span className="mt-1 block">
                <Progress
                  done={epic.done}
                  total={epic.total}
                  label={`${String(epic.done)} of ${String(epic.total)} issues done in ${epic.summary}`}
                />
              </span>
            </Entry>
          ))}
          {epics.data.length === 0 ? (
            <li>
              <UxEmptyState
                reason="no_data"
                title="No epics yet"
                description="Group related work under an epic, then drag issues onto it."
              />
            </li>
          ) : null}
        </ul>
      )}
    </section>
  );
}
