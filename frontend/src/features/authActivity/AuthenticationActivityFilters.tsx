import { X } from 'lucide-react';
import type { SetURLSearchParams } from 'react-router';

import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { cn } from '../../lib/cn';
import type { Member } from '../../lib/api/types';
import { datetimeLocalToIso, isoToDatetimeLocalValue } from '../audit/auditDateParams';

import { AUTH_ACTIVITY_EVENT_TYPES, formatAuthActivityEventType } from './authActivityEventTypes';
import {
  AUTH_ACTIVITY_FILTER_KEYS,
  AUTH_ACTIVITY_FILTER_LABEL,
  formatAuthActivityChipValue,
  hasActiveAuthActivityFilters,
  type ParsedAuthActivitySearch,
} from './authActivitySearchParams';

const selectClass =
  'mt-1 h-8 w-full max-w-full rounded-md border border-line-strong bg-surface px-2.5 text-sm text-fg sm:mt-0 sm:w-auto';

function setFilterParam(setSearch: SetURLSearchParams, name: string, value: string) {
  setSearch(
    (prev) => {
      const next = new URLSearchParams(prev);
      if (value) next.set(name, value);
      else next.delete(name);
      return next;
    },
    { replace: true },
  );
}

export function AuthenticationActivityFilters({
  searchParams,
  setSearch,
  parsed,
  members,
}: {
  searchParams: URLSearchParams;
  setSearch: SetURLSearchParams;
  parsed: ParsedAuthActivitySearch;
  members: Member[];
}) {
  const memberById = new Map(members.map((m) => [m.user_id, m]));
  const sortedMembers = [...members].sort((a, b) =>
    a.display_name.localeCompare(b.display_name, undefined, { sensitivity: 'base' }),
  );
  const inputClass = 'mt-1 w-full max-w-full sm:mt-0 sm:w-auto';

  const chips = AUTH_ACTIVITY_FILTER_KEYS.flatMap((name) => {
    const raw = searchParams.get(name);
    if (!raw?.trim()) return [];
    const memberLabel = name === 'member' ? memberById.get(raw.trim())?.display_name : undefined;
    return [
      {
        name,
        value: raw,
        display: formatAuthActivityChipValue(name, raw.trim(), memberLabel),
      },
    ];
  });

  return (
    <div className="space-y-3">
      <div
        className="flex flex-col gap-3 text-sm text-[var(--admin-text)] sm:flex-row sm:flex-wrap sm:items-end sm:gap-4"
        role="group"
        aria-label="Filters"
      >
        <label className="flex min-w-0 flex-col gap-1">
          Member
          {/* Active members only; removed members stay in results with a Removed badge (URL member= still works). */}
          <select
            aria-label="Member"
            value={parsed.member ?? ''}
            onChange={(e) => {
              setFilterParam(setSearch, 'member', e.target.value);
            }}
            className={cn(selectClass)}
          >
            <option value="">All members</option>
            {sortedMembers.map((m) => (
              <option key={m.user_id} value={m.user_id}>
                {m.display_name}
              </option>
            ))}
          </select>
          {parsed.invalid.member ? (
            <span className="text-xs text-danger">Invalid member filter; not applied.</span>
          ) : null}
        </label>
        <label className="flex min-w-0 flex-col gap-1">
          Event type
          <select
            aria-label="Event type"
            value={parsed.event_type ?? ''}
            onChange={(e) => {
              setFilterParam(setSearch, 'event_type', e.target.value);
            }}
            className={cn(selectClass)}
          >
            <option value="">All event types</option>
            {AUTH_ACTIVITY_EVENT_TYPES.map((type) => (
              <option key={type} value={type}>
                {formatAuthActivityEventType(type)}
              </option>
            ))}
          </select>
          {parsed.invalid.event_type ? (
            <span className="text-xs text-danger">Unsupported event type; not applied.</span>
          ) : null}
        </label>
        <label className="flex min-w-0 flex-col gap-1">
          From
          <Input
            type="datetime-local"
            aria-label="From"
            value={isoToDatetimeLocalValue(searchParams.get('from'))}
            onChange={(e) => {
              const iso = datetimeLocalToIso(e.target.value);
              setFilterParam(setSearch, 'from', iso ?? '');
            }}
            className={inputClass}
          />
          {parsed.invalid.from ? (
            <span className="text-xs text-danger">Invalid date; not applied.</span>
          ) : null}
        </label>
        <label className="flex min-w-0 flex-col gap-1">
          To
          <Input
            type="datetime-local"
            aria-label="To"
            value={isoToDatetimeLocalValue(searchParams.get('to'))}
            onChange={(e) => {
              const iso = datetimeLocalToIso(e.target.value);
              setFilterParam(setSearch, 'to', iso ?? '');
            }}
            className={inputClass}
          />
          {parsed.invalid.to ? (
            <span className="text-xs text-danger">Invalid date; not applied.</span>
          ) : null}
        </label>
        {hasActiveAuthActivityFilters(searchParams) ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="sm:mb-0.5"
            onClick={() => {
              setSearch(new URLSearchParams(), { replace: true });
            }}
          >
            Clear filters
          </Button>
        ) : null}
      </div>
      {chips.length > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-label="Active filters">
          {chips.map((chip) => (
            <li key={chip.name}>
              <Badge tone="accent" className="gap-1">
                {AUTH_ACTIVITY_FILTER_LABEL[chip.name]}: {chip.display}
                <button
                  type="button"
                  aria-label={`Remove ${AUTH_ACTIVITY_FILTER_LABEL[chip.name]} filter`}
                  onClick={() => {
                    setFilterParam(setSearch, chip.name, '');
                  }}
                  className="rounded hover:bg-accent/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--admin-accent)]"
                >
                  <X className="size-3" aria-hidden="true" />
                </button>
              </Badge>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
