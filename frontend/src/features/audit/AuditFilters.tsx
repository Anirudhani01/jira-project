import { X } from 'lucide-react';
import { useState } from 'react';
import type { SetURLSearchParams } from 'react-router';

import { Badge } from '../../components/ui/Badge';
import { Input } from '../../components/ui/Input';
import { cn } from '../../lib/cn';
import type { Member } from '../../lib/api/types';

import {
  AUDIT_FILTER_KEYS,
  AUDIT_FILTER_LABEL,
  formatFilterChipValue,
  type ParsedAuditSearch,
} from './auditSearchParams';
import { datetimeLocalToIso, isoToDatetimeLocalValue } from './auditDateParams';
import { formatActorFilterLabel } from './auditActorLabel';

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

export function AuditFilters({
  searchParams,
  setSearch,
  parsed,
  members,
}: {
  searchParams: URLSearchParams;
  setSearch: SetURLSearchParams;
  parsed: ParsedAuditSearch;
  members: Member[];
}) {
  const memberById = new Map(members.map((m) => [m.user_id, m]));
  const sortedMembers = [...members].sort((a, b) =>
    a.display_name.localeCompare(b.display_name, undefined, { sensitivity: 'base' }),
  );

  const chips = AUDIT_FILTER_KEYS.flatMap((name) => {
    const raw = searchParams.get(name);
    if (!raw?.trim()) return [];
    const actorLabel =
      name === 'actor' ? formatActorFilterLabel(raw.trim(), memberById) : undefined;
    return [{ name, value: raw, display: formatFilterChipValue(name, raw, actorLabel) }];
  });

  const inputClass = 'mt-1 w-full max-w-full sm:mt-0 sm:w-auto';
  const urlAction = searchParams.get('action') ?? '';
  const [actionFocused, setActionFocused] = useState(false);
  const [actionDraft, setActionDraft] = useState(urlAction);
  const actionValue = actionFocused ? actionDraft : urlAction;

  return (
    <div className="space-y-3">
      <div
        className="flex flex-col gap-3 text-sm text-[var(--admin-text)] sm:flex-row sm:flex-wrap sm:items-end sm:gap-4"
        role="group"
        aria-label="Filters"
      >
        <label className="flex min-w-0 flex-col gap-1">
          Action
          <Input
            type="text"
            maxLength={64}
            placeholder="e.g. project.created"
            aria-label="Action"
            value={actionValue}
            onFocus={() => {
              setActionFocused(true);
              setActionDraft(urlAction);
            }}
            onChange={(e) => {
              setActionDraft(e.target.value);
            }}
            onBlur={() => {
              setActionFocused(false);
              setFilterParam(setSearch, 'action', actionDraft.trim());
            }}
            className={inputClass}
          />
        </label>
        <label className="flex min-w-0 flex-col gap-1">
          Actor
          <select
            aria-label="Actor"
            value={parsed.actor ?? ''}
            onChange={(e) => {
              setFilterParam(setSearch, 'actor', e.target.value);
            }}
            className={cn(selectClass)}
          >
            <option value="">All actors</option>
            {sortedMembers.map((m) => (
              <option key={m.user_id} value={m.user_id}>
                {m.display_name}
              </option>
            ))}
          </select>
          {parsed.invalid.actor ? (
            <span className="text-xs text-danger">Invalid actor filter; not applied.</span>
          ) : null}
        </label>
        <label className="flex min-w-0 flex-col gap-1">
          From
          <Input
            type="datetime-local"
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
      </div>
      {chips.length > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-label="Active filters">
          {chips.map((chip) => (
            <li key={chip.name}>
              <Badge tone="accent" className="gap-1">
                {AUDIT_FILTER_LABEL[chip.name]}: {chip.display}
                <button
                  type="button"
                  aria-label={`Remove ${AUDIT_FILTER_LABEL[chip.name]} filter`}
                  onClick={() => {
                    setFilterParam(setSearch, chip.name, '');
                  }}
                  className="rounded hover:bg-accent/20"
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
