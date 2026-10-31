import { Link, useParams, useSearchParams } from 'react-router';

import { NotFoundPage } from '../../app/pages/NotFoundPage';
import { UxPermissionDenied } from '../../components/ux/UxPermissionDenied';
import { ErrorState, LoadingState } from '../../components/ui/States';
import { ApiError } from '../../lib/api/errors';
import { isRbacForbidden, toUxPermissionDeniedProps } from '../../lib/ux/permissionDenied';
import { useOrg } from '../orgs/api';

import { useAuditEvents } from './api';

const FILTERS = ['action', 'from', 'to'] as const;

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

  return (
    <section aria-labelledby="audit-title" className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 id="audit-title" className="text-2xl font-semibold">
          Audit log
        </h1>
        <Link className="text-blue-700 underline" to={`/o/${org}`}>
          Back to {organization.data.name}
        </Link>
      </div>
      <div className="flex flex-wrap gap-4 text-sm" role="group" aria-label="Filters">
        <label>
          Action{' '}
          <input
            type="text"
            maxLength={64}
            placeholder="e.g. project.created"
            defaultValue={search.get('action') ?? ''}
            onBlur={(e) => {
              setFilter('action', e.target.value.trim());
            }}
            className="rounded border border-slate-300 px-2 py-1"
          />
        </label>
        <label>
          From{' '}
          <input
            type="datetime-local"
            onChange={(e) => {
              setFilter('from', toIso(e.target.value));
            }}
            className="rounded border border-slate-300 px-2 py-1"
          />
        </label>
        <label>
          To{' '}
          <input
            type="datetime-local"
            onChange={(e) => {
              setFilter('to', toIso(e.target.value));
            }}
            className="rounded border border-slate-300 px-2 py-1"
          />
        </label>
      </div>
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
        <p className="text-slate-600">No events match these filters.</p>
      ) : null}
      {items.length > 0 ? (
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Audit events, newest first</caption>
          <thead>
            <tr className="border-b">
              <th scope="col" className="py-1">
                When
              </th>
              <th scope="col">Action</th>
              <th scope="col">Outcome</th>
              <th scope="col">Target</th>
              <th scope="col">Details</th>
            </tr>
          </thead>
          <tbody>
            {items.map((event) => (
              <tr key={event.id} className="border-b align-top">
                <td className="py-1 pr-2 whitespace-nowrap">
                  {new Date(event.created_at).toLocaleString()}
                </td>
                <td className="pr-2 font-mono">{event.action}</td>
                <td className="pr-2">{event.outcome}</td>
                <td className="pr-2">
                  {event.target_type ? `${event.target_type} ${event.target_id ?? ''}` : '—'}
                </td>
                <td className="font-mono text-xs">
                  {Object.entries(event.metadata)
                    .map(([key, value]) => `${key}=${String(value)}`)
                    .join(' ')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {events.hasNextPage ? (
        <button
          type="button"
          disabled={events.isFetchingNextPage}
          onClick={() => void events.fetchNextPage()}
          className="rounded border border-slate-300 px-3 py-1 text-sm"
        >
          Load more
        </button>
      ) : null}
    </section>
  );
}
