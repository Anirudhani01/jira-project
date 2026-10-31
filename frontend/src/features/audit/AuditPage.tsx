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
    <section aria-labelledby="audit-title" className="min-w-0 space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 id="audit-title" className="text-2xl font-semibold">
          Audit log
        </h1>
        <Link className="shrink-0 text-blue-700 underline" to={`/o/${org}`}>
          Back to {organization.data.name}
        </Link>
      </div>
      <div
        className="flex flex-col gap-3 text-sm sm:flex-row sm:flex-wrap sm:gap-4"
        role="group"
        aria-label="Filters"
      >
        <label className="flex min-w-0 flex-col gap-1 sm:block">
          Action{' '}
          <input
            type="text"
            maxLength={64}
            placeholder="e.g. project.created"
            defaultValue={search.get('action') ?? ''}
            onBlur={(e) => {
              setFilter('action', e.target.value.trim());
            }}
            className="mt-1 w-full max-w-full rounded border border-slate-300 px-2 py-1 sm:mt-0 sm:w-auto"
          />
        </label>
        <label className="flex min-w-0 flex-col gap-1 sm:block">
          From{' '}
          <input
            type="datetime-local"
            onChange={(e) => {
              setFilter('from', toIso(e.target.value));
            }}
            className="mt-1 w-full max-w-full rounded border border-slate-300 px-2 py-1 sm:mt-0 sm:w-auto"
          />
        </label>
        <label className="flex min-w-0 flex-col gap-1 sm:block">
          To{' '}
          <input
            type="datetime-local"
            onChange={(e) => {
              setFilter('to', toIso(e.target.value));
            }}
            className="mt-1 w-full max-w-full rounded border border-slate-300 px-2 py-1 sm:mt-0 sm:w-auto"
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
        <div className="min-w-0 max-w-full overflow-x-auto">
          <table className="w-full min-w-[36rem] text-left text-sm">
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
                  <td className="max-w-[10rem] pr-2 break-words sm:max-w-none">
                    {event.target_type ? `${event.target_type} ${event.target_id ?? ''}` : '—'}
                  </td>
                  <td className="max-w-[14rem] break-all font-mono text-xs sm:max-w-md">
                    {Object.entries(event.metadata)
                      .map(([key, value]) => `${key}=${String(value)}`)
                      .join(' ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
