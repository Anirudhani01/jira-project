import { useMemo } from 'react';
import { useParams, useSearchParams } from 'react-router';

import { UxPermissionDenied } from '../../components/ux/UxPermissionDenied';
import { Button } from '../../components/ui/Button';
import { ErrorState, LoadingState } from '../../components/ui/States';
import { isRbacForbidden, toUxPermissionDeniedProps } from '../../lib/ux/permissionDenied';
import { useMembers, useOrg } from '../orgs/api';
import { AdminOrgManagePageFrame } from '../admin/pages/AdminOrgManagePageFrame';

import { AuditFilters } from './AuditFilters';
import { AuditEventRow } from './AuditEventRow';
import { buildMemberById } from './auditActorLabel';
import { auditFiltersForApi, parseAuditSearchParams } from './auditSearchParams';
import { useAuditEvents } from './api';

function AuditLogContent() {
  const { org = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const organization = useOrg(org);
  const parsed = useMemo(() => parseAuditSearchParams(searchParams), [searchParams]);
  const apiFilters = useMemo(() => auditFiltersForApi(parsed), [parsed]);
  const canViewAudit =
    organization.isSuccess && organization.data.permissions.includes('org.audit.view');
  const membersQuery = useMembers(org, { enabled: canViewAudit });
  const events = useAuditEvents(org, apiFilters, canViewAudit);
  const memberById = useMemo(() => buildMemberById(membersQuery.data ?? []), [membersQuery.data]);
  const items = events.data?.pages.flatMap((page) => page.items) ?? [];

  if (!canViewAudit) {
    return <UxPermissionDenied {...toUxPermissionDeniedProps('org-audit', { orgSlug: org })} />;
  }

  return (
    <div className="space-y-6">
      <section
        className="admin-card space-y-4 rounded-xl border p-5 sm:p-6"
        aria-labelledby="audit-filters-heading"
      >
        <h2 id="audit-filters-heading" className="text-lg font-semibold text-[var(--admin-text)]">
          Filters
        </h2>
        <AuditFilters
          searchParams={searchParams}
          setSearch={setSearchParams}
          parsed={parsed}
          members={membersQuery.data ?? []}
        />
      </section>

      <section
        className="admin-card space-y-4 rounded-xl border p-5 sm:p-6"
        aria-labelledby="audit-events-heading"
      >
        <h2 id="audit-events-heading" className="text-lg font-semibold text-[var(--admin-text)]">
          Events
        </h2>
        {events.isPending ? <LoadingState label="Loading events" /> : null}
        {events.isError ? (
          isRbacForbidden(events.error) ? (
            <UxPermissionDenied
              {...toUxPermissionDeniedProps('org-audit', { orgSlug: org }, events.error)}
            />
          ) : (
            <ErrorState error={events.error} onRetry={() => void events.refetch()} />
          )
        ) : null}
        {events.isSuccess && items.length === 0 ? (
          <p className="text-sm text-[var(--admin-muted)]">No events match these filters.</p>
        ) : null}
        {items.length > 0 ? (
          <div className="min-w-0 max-w-full overflow-x-auto">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <caption className="sr-only">Audit events, newest first</caption>
              <thead>
                <tr className="border-b border-[var(--admin-border)] text-[var(--admin-muted)]">
                  <th scope="col" className="py-2 pr-3 font-medium">
                    When
                  </th>
                  <th scope="col" className="pr-3 font-medium">
                    Actor
                  </th>
                  <th scope="col" className="pr-3 font-medium">
                    Action
                  </th>
                  <th scope="col" className="pr-3 font-medium">
                    Outcome
                  </th>
                  <th scope="col" className="hidden pr-3 font-medium sm:table-cell">
                    Target
                  </th>
                  <th scope="col" className="font-medium">
                    Details
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((event) => (
                  <AuditEventRow
                    key={event.id}
                    event={event}
                    memberById={memberById}
                    membersLoaded={membersQuery.isSuccess}
                  />
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
    </div>
  );
}

/** Audit log for org owners and admins; filters live in the URL. */
export function AuditPage() {
  return (
    <AdminOrgManagePageFrame
      title="Audit Logs"
      titleId="audit-title"
      description="Organization activity recorded for owners and administrators."
      requireManage={false}
    >
      <AuditLogContent />
    </AdminOrgManagePageFrame>
  );
}
