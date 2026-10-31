import { ChevronDown, ChevronRight, X } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';

import { NotFoundPage } from '../../app/pages/NotFoundPage';
import { UxPermissionDenied } from '../../components/ux/UxPermissionDenied';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { ErrorState, LoadingState } from '../../components/ui/States';
import { ApiError } from '../../lib/api/errors';
import { isRbacForbidden, toUxPermissionDeniedProps } from '../../lib/ux/permissionDenied';
import { useOrg } from '../orgs/api';

import type { AuditEvent } from '../../lib/api/types';
import { useAuditEvents } from './api';

const FILTERS = ['action', 'from', 'to'] as const;
const FILTER_LABEL = { action: 'Action', from: 'From', to: 'To' } as const;

function EventRow({ event }: { event: AuditEvent }) {
  const [open, setOpen] = useState(false);
  const entries = Object.entries(event.metadata);
  return (
    <>
      <tr className="border-b border-line align-top">
        <td className="py-2 pr-3 whitespace-nowrap text-fg-muted">
          {new Date(event.created_at).toLocaleString()}
        </td>
        <td className="pr-3 font-mono text-fg">{event.action}</td>
        <td className="pr-3">
          <Badge tone={event.outcome === 'success' ? 'success' : 'danger'}>{event.outcome}</Badge>
        </td>
        <td className="max-w-[10rem] pr-3 break-words text-fg sm:max-w-none">
          {event.target_type ? `${event.target_type} ${event.target_id ?? ''}` : '—'}
        </td>
        <td className="max-w-[14rem] font-mono text-xs break-all text-fg-muted sm:max-w-md">
          {entries.length === 0 ? (
            '—'
          ) : (
            <>
              <button
                type="button"
                aria-expanded={open}
                aria-label={`${open ? 'Hide' : 'Show'} details for ${event.action}`}
                onClick={() => {
                  setOpen((value) => !value);
                }}
                className="mr-1 inline-flex align-middle text-fg-muted hover:text-fg"
              >
                {open ? (
                  <ChevronDown className="size-3.5" aria-hidden="true" />
                ) : (
                  <ChevronRight className="size-3.5" aria-hidden="true" />
                )}
              </button>
              {entries.map(([key, value]) => `${key}=${String(value)}`).join(' ')}
            </>
          )}
        </td>
      </tr>
      {open ? (
        <tr className="border-b border-line bg-surface-2">
          <td colSpan={5} className="px-3 py-2">
            <pre className="overflow-x-auto font-mono text-xs text-fg">
              {JSON.stringify(event.metadata, null, 2)}
            </pre>
            {event.request_id ? (
              <p className="mt-1 text-xs text-fg-muted">Request {event.request_id}</p>
            ) : null}
          </td>
        </tr>
      ) : null}
    </>
  );
}

/** Audit log for org owners and admins; filters live in the URL. */
export function AuditPage() {
  const { org = '' } = useParams();
  const [search, setSearch] = useSearchParams();
  const organization = useOrg(org);
  const filters = Object.fromEntries(FILTERS.map((name) => [name, search.get(name) ?? undefined]));
  const canViewAudit =
    organization.isSuccess && organization.data.permissions.includes('org.audit.view');
  const events = useAuditEvents(org, filters, canViewAudit);

  if (organization.isPending) return <LoadingState label="Loading audit log" />;
  if (organization.error instanceof ApiError && organization.error.status === 404) {
    return <NotFoundPage />;
  }
  if (organization.isError) return <ErrorState error={organization.error} />;
  if (!canViewAudit) {
    return (
      <section aria-labelledby="audit-title" className="space-y-4">
        <h1 id="audit-title" className="text-2xl font-semibold">
          Audit log
        </h1>
        <UxPermissionDenied {...toUxPermissionDeniedProps('org-audit', { orgSlug: org })} />
      </section>
    );
  }

  const items = events.data?.pages.flatMap((page) => page.items) ?? [];
  const setFilter = (name: string, value: string) => {
    const next = new URLSearchParams(search);
    if (value) next.set(name, value);
    else next.delete(name);
    setSearch(next);
  };
  const toIso = (local: string) => (local ? new Date(local).toISOString() : '');

  const chips = FILTERS.flatMap((name) => {
    const value = search.get(name);
    return value ? [{ name, value }] : [];
  });
  const inputClass = 'mt-1 w-full max-w-full sm:mt-0 sm:w-auto';

  return (
    <section aria-labelledby="audit-title" className="min-w-0 space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 id="audit-title" className="text-2xl font-semibold text-fg">
          Audit log
        </h1>
        <Link className="shrink-0 text-accent underline" to={`/o/${org}`}>
          Back to {organization.data.name}
        </Link>
      </div>
      <div
        className="flex flex-col gap-3 text-sm text-fg sm:flex-row sm:flex-wrap sm:items-end sm:gap-4"
        role="group"
        aria-label="Filters"
      >
        <label className="flex min-w-0 flex-col gap-1">
          Action
          <Input
            type="text"
            maxLength={64}
            placeholder="e.g. project.created"
            defaultValue={search.get('action') ?? ''}
            key={search.get('action') ?? ''}
            onBlur={(e) => {
              setFilter('action', e.target.value.trim());
            }}
            className={inputClass}
          />
        </label>
        <label className="flex min-w-0 flex-col gap-1">
          From
          <Input
            type="datetime-local"
            onChange={(e) => {
              setFilter('from', toIso(e.target.value));
            }}
            className={inputClass}
          />
        </label>
        <label className="flex min-w-0 flex-col gap-1">
          To
          <Input
            type="datetime-local"
            onChange={(e) => {
              setFilter('to', toIso(e.target.value));
            }}
            className={inputClass}
          />
        </label>
      </div>
      {chips.length > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-label="Active filters">
          {chips.map((chip) => (
            <li key={chip.name}>
              <Badge tone="accent" className="gap-1">
                {FILTER_LABEL[chip.name]}:{' '}
                {chip.name === 'action' ? chip.value : new Date(chip.value).toLocaleString()}
                <button
                  type="button"
                  aria-label={`Remove ${FILTER_LABEL[chip.name]} filter`}
                  onClick={() => {
                    setFilter(chip.name, '');
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
      {events.isPending ? <LoadingState label="Loading events" /> : null}
      {events.isError ? (
        isRbacForbidden(events.error) ? (
          <UxPermissionDenied
            {...toUxPermissionDeniedProps('org-audit', { orgSlug: org }, events.error)}
          />
        ) : (
          <ErrorState error={events.error} />
        )
      ) : null}
      {events.isSuccess && items.length === 0 ? (
        <p className="text-fg-muted">No events match these filters.</p>
      ) : null}
      {items.length > 0 ? (
        <div className="min-w-0 max-w-full overflow-x-auto">
          <table className="w-full min-w-[36rem] text-left text-sm">
            <caption className="sr-only">Audit events, newest first</caption>
            <thead>
              <tr className="border-b border-line-strong text-fg-muted">
                <th scope="col" className="py-2 pr-3 font-medium">
                  When
                </th>
                <th scope="col" className="pr-3 font-medium">
                  Action
                </th>
                <th scope="col" className="pr-3 font-medium">
                  Outcome
                </th>
                <th scope="col" className="pr-3 font-medium">
                  Target
                </th>
                <th scope="col" className="font-medium">
                  Details
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((event) => (
                <EventRow key={event.id} event={event} />
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {events.hasNextPage ? (
        <Button
          variant="secondary"
          size="sm"
          disabled={events.isFetchingNextPage}
          onClick={() => void events.fetchNextPage()}
        >
          {events.isFetchingNextPage ? 'Loading…' : 'Load more'}
        </Button>
      ) : null}
    </section>
  );
}
