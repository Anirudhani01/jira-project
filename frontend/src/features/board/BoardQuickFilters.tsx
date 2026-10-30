import { Search, SlidersHorizontal, X } from 'lucide-react';
import { useSearchParams } from 'react-router';

import { useBoardShell } from '../../app/shell/useBoardShell';
import { Avatar } from '../../components/ui/Avatar';
import { Button, IconButton } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { cn } from '../../lib/cn';
import { useSession } from '../auth/api';

import {
  boardFiltersActive,
  collectBoardFilterMeta,
  parseBoardFilters,
  writeBoardFilters,
  type BoardFilters,
} from './boardFilters';
import type { Board } from '../../lib/api/types';

export function BoardQuickFilters({
  board,
  currentUserId,
}: {
  board: Board;
  currentUserId?: string | undefined;
}) {
  const [search, setSearch] = useSearchParams();
  const filters = parseBoardFilters(search);
  const meta = collectBoardFilterMeta(board);
  const boardChrome = useBoardShell();
  const session = useSession();
  const me = session.data?.user;

  const patch = (next: BoardFilters) => {
    setSearch(writeBoardFilters(search, next));
  };

  const toggleAssignee = (id: string) => {
    const set = new Set(filters.assignees);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    patch({ ...filters, assignees: [...set] });
  };

  const assigneePeople =
    boardChrome && me
      ? (() => {
          const onBoard = meta.assignees.filter((p) => p.id === me.id);
          if (onBoard.length) return onBoard;
          if (currentUserId) {
            return [{ id: me.id, name: me.display_name.trim() || me.email }];
          }
          return [];
        })()
      : meta.assignees;

  const filterSelectClass = boardChrome
    ? 'board-filter-select max-w-[8rem] border-0 bg-transparent py-0 pl-0 pr-6 text-sm font-medium text-[var(--board-text)]'
    : 'rounded-md border border-line bg-surface px-2 py-1 text-sm text-fg';

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface p-4 sm:p-5',
        boardChrome &&
          'board-filter-toolbar gap-2 border-[var(--board-border)] bg-[var(--board-surface)] p-3 sm:gap-3 sm:p-4',
      )}
    >
      <div className={cn('relative min-w-[12rem] flex-1', boardChrome && 'min-w-[14rem]')}>
        <Search
          className={cn(
            'pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-fg-subtle',
            boardChrome && 'left-3 text-[var(--board-muted)]',
          )}
          aria-hidden="true"
        />
        <Input
          type="search"
          aria-label="Filter board"
          placeholder="Filter cards…"
          className={cn('pl-8', boardChrome && 'board-search h-9 rounded-lg pl-9 text-sm')}
          value={filters.q}
          onChange={(e) => {
            patch({ ...filters, q: e.target.value });
          }}
        />
      </div>

      {assigneePeople.length > 0 ? (
        <div className="flex items-center gap-1" role="group" aria-label="Filter by assignee">
          {assigneePeople.map((person) => {
            const active = filters.assignees.includes(person.id);
            return (
              <button
                key={person.id}
                type="button"
                aria-pressed={active}
                title={person.name}
                onClick={() => {
                  toggleAssignee(person.id);
                }}
                className={cn(
                  'rounded-full ring-2 ring-transparent transition',
                  active && (boardChrome ? 'ring-[var(--board-accent)]' : 'ring-accent'),
                )}
              >
                <Avatar name={person.name} size="sm" />
                <span className="sr-only">{person.name}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      <Button
        type="button"
        size="sm"
        variant={filters.mine ? 'primary' : 'secondary'}
        aria-pressed={filters.mine}
        disabled={!currentUserId}
        className={cn(
          boardChrome &&
            (filters.mine
              ? 'board-btn-primary board-filter-pill rounded-full px-3'
              : 'board-filter-pill board-btn-secondary rounded-full px-3 font-normal'),
        )}
        onClick={() => {
          patch({ ...filters, mine: !filters.mine });
        }}
      >
        Only my issues
      </Button>

      {meta.types.length > 0 ? (
        <label
          className={cn(
            'flex items-center gap-1.5 text-sm text-fg-muted',
            boardChrome && 'board-filter-pill text-[var(--board-muted)]',
          )}
        >
          {boardChrome ? <span className="shrink-0 text-[var(--board-muted)]">Type:</span> : 'Type'}
          <select
            className={filterSelectClass}
            value={filters.typeId}
            aria-label="Type"
            onChange={(e) => {
              patch({ ...filters, typeId: e.target.value });
            }}
          >
            <option value="">Any</option>
            {meta.types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {meta.labels.length > 0 ? (
        <label
          className={cn(
            'flex items-center gap-1.5 text-sm text-fg-muted',
            boardChrome && 'board-filter-pill text-[var(--board-muted)]',
          )}
        >
          {boardChrome ? (
            <span className="shrink-0 text-[var(--board-muted)]">Label:</span>
          ) : (
            'Label'
          )}
          <select
            className={filterSelectClass}
            value={filters.labelId}
            aria-label="Label"
            onChange={(e) => {
              patch({ ...filters, labelId: e.target.value });
            }}
          >
            <option value="">Any</option>
            {meta.labels.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {boardChrome ? (
        <IconButton
          label="Advanced filters — not available yet"
          size="sm"
          className="board-btn-secondary ml-auto rounded-lg sm:ml-0"
          disabled
          title="Advanced filters are not available yet"
        >
          <SlidersHorizontal className="size-4" aria-hidden="true" />
        </IconButton>
      ) : null}

      {boardFiltersActive(filters) ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => {
            patch({
              q: '',
              mine: false,
              assignees: [],
              typeId: '',
              labelId: '',
            });
          }}
        >
          <X className="size-4" aria-hidden="true" />
          Clear
        </Button>
      ) : null}
    </div>
  );
}
