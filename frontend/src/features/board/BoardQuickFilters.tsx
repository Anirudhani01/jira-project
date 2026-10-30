import { Search, X } from 'lucide-react';
import { useSearchParams } from 'react-router';

import { Avatar } from '../../components/ui/Avatar';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { cn } from '../../lib/cn';

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

  const patch = (next: BoardFilters) => {
    setSearch(writeBoardFilters(search, next));
  };

  const toggleAssignee = (id: string) => {
    const set = new Set(filters.assignees);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    patch({ ...filters, assignees: [...set] });
  };

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface p-4 sm:p-5">
      <div className="relative min-w-[12rem] flex-1">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-fg-subtle"
          aria-hidden="true"
        />
        <Input
          type="search"
          aria-label="Filter board"
          placeholder="Filter cards…"
          className="pl-8"
          value={filters.q}
          onChange={(e) => {
            patch({ ...filters, q: e.target.value });
          }}
        />
      </div>

      {meta.assignees.length > 0 ? (
        <div className="flex items-center gap-1" role="group" aria-label="Filter by assignee">
          {meta.assignees.map((person) => {
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
                  active && 'ring-accent',
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
        onClick={() => {
          patch({ ...filters, mine: !filters.mine });
        }}
      >
        Only my issues
      </Button>

      {meta.types.length > 0 ? (
        <label className="flex items-center gap-1.5 text-sm text-fg-muted">
          Type
          <select
            className="rounded-md border border-line bg-surface px-2 py-1 text-sm text-fg"
            value={filters.typeId}
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
        <label className="flex items-center gap-1.5 text-sm text-fg-muted">
          Label
          <select
            className="rounded-md border border-line bg-surface px-2 py-1 text-sm text-fg"
            value={filters.labelId}
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
