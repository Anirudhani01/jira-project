import { useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';

import { UxPermissionDenied } from '../../components/ux/UxPermissionDenied';
import { ErrorState, LoadingState } from '../../components/ui/States';
import { isRbacForbidden, toUxPermissionDeniedProps } from '../../lib/ux/permissionDenied';
import { useMembers, useOrg } from '../orgs/api';
import { AdminOrgManagePageFrame } from '../admin/pages/AdminOrgManagePageFrame';

import { DEFAULT_AUTH_ACTIVITY_PAGE_SIZE, useAuthenticationActivityPage } from './api';
import { AuthenticationActivityFilters } from './AuthenticationActivityFilters';
import { AuthenticationActivityPagination } from './AuthenticationActivityPagination';
import {
  AuthenticationActivityMobileCard,
  AuthenticationActivityTableRow,
} from './AuthenticationActivityRow';
import {
  authActivityFiltersForApi,
  hasActiveAuthActivityFilters,
  parseAuthActivitySearchParams,
} from './authActivitySearchParams';

function AuthenticationActivityContent() {
  const { org = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const organization = useOrg(org);
  const parsed = useMemo(() => parseAuthActivitySearchParams(searchParams), [searchParams]);
  const apiFilters = useMemo(() => authActivityFiltersForApi(parsed), [parsed]);
  const canViewAudit =
    organization.isSuccess && organization.data.permissions.includes('org.audit.view');
  const membersQuery = useMembers(org, { enabled: canViewAudit });
  const [pageSize, setPageSize] = useState(DEFAULT_AUTH_ACTIVITY_PAGE_SIZE);
  // Cursors of the pages seen so far, per filters + page size: changing either starts at page 1.
  const scope = `${JSON.stringify(apiFilters)}|${String(pageSize)}`;
  const [cursorsByScope, setCursorsByScope] = useState<Record<string, (string | null)[]>>({});
  const cursors = cursorsByScope[scope] ?? [null];
  const pageIndex = cursors.length - 1;
  const activity = useAuthenticationActivityPage(
    org,
    apiFilters,
    { cursor: cursors[pageIndex] ?? null, limit: pageSize },
    canViewAudit,
  );
  const items = activity.data?.items ?? [];
  const nextCursor = activity.data?.next_cursor ?? null;
  const filtersActive = hasActiveAuthActivityFilters(searchParams);
  const showInitialLoading = activity.isPending && items.length === 0;
  const showRefetchLoading = activity.isFetching && items.length > 0;

  if (!canViewAudit) {
    return <UxPermissionDenied {...toUxPermissionDeniedProps('org-audit', { orgSlug: org })} />;
  }

  return (
    <div className="space-y-6">
      <section
        className="admin-card space-y-4 rounded-xl border p-5 sm:p-6"
        aria-labelledby="auth-activity-filters-heading"
      >
        <h2
          id="auth-activity-filters-heading"
          className="text-lg font-medium text-[var(--admin-text)]"
        >
          Filters
        </h2>
        <AuthenticationActivityFilters
          searchParams={searchParams}
          setSearch={setSearchParams}
          parsed={parsed}
          members={membersQuery.data ?? []}
        />
      </section>

      <section
        className="admin-card space-y-4 rounded-xl border p-5 sm:p-6"
        aria-labelledby="auth-activity-table-heading"
        aria-busy={showInitialLoading || showRefetchLoading}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2
            id="auth-activity-table-heading"
            className="text-lg font-medium text-[var(--admin-text)]"
          >
            Activity
          </h2>
          {showRefetchLoading ? (
            <p className="text-sm text-[var(--admin-muted)]" role="status">
              Updating results…
            </p>
          ) : null}
        </div>

        {showInitialLoading ? <LoadingState label="Loading authentication activity" /> : null}

        {activity.isError ? (
          isRbacForbidden(activity.error) ? (
            <UxPermissionDenied
              {...toUxPermissionDeniedProps('org-audit', { orgSlug: org }, activity.error)}
            />
          ) : (
            <ErrorState error={activity.error} onRetry={() => void activity.refetch()} />
          )
        ) : null}

        {activity.isSuccess && items.length === 0 && !filtersActive ? (
          <p className="text-sm text-[var(--admin-muted)]">
            No authentication activity has been recorded for this organization yet.
          </p>
        ) : null}

        {activity.isSuccess && items.length === 0 && filtersActive ? (
          <p className="text-sm text-[var(--admin-muted)]">
            No activity matches the selected filters. Try adjusting the member, event type, or date
            range.
          </p>
        ) : null}

        {items.length > 0 ? (
          <>
            <div className="hidden min-w-0 max-w-full overflow-x-auto sm:block">
              <table className="w-full min-w-[36rem] text-left text-sm">
                <caption className="sr-only">Authentication activity, newest first</caption>
                <thead>
                  <tr className="border-b border-[var(--admin-border)] text-[var(--admin-muted)]">
                    <th scope="col" className="py-2 pr-3 font-medium">
                      Member
                    </th>
                    <th scope="col" className="pr-3 font-medium">
                      Event
                    </th>
                    <th scope="col" className="pr-3 font-medium">
                      Timestamp
                    </th>
                    <th scope="col" className="font-medium">
                      Details
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <AuthenticationActivityTableRow key={item.id} item={item} />
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="space-y-3 sm:hidden" aria-label="Authentication activity">
              {items.map((item) => (
                <li key={item.id}>
                  <AuthenticationActivityMobileCard item={item} />
                </li>
              ))}
            </ul>
          </>
        ) : null}

        {items.length > 0 ? (
          <AuthenticationActivityPagination
            pageIndex={pageIndex}
            pageSize={pageSize}
            itemCount={items.length}
            hasPrevious={pageIndex > 0}
            hasNext={nextCursor !== null}
            loading={activity.isFetching}
            onPrevious={() => {
              setCursorsByScope((prev) => ({ ...prev, [scope]: cursors.slice(0, -1) }));
            }}
            onNext={() => {
              setCursorsByScope((prev) => ({ ...prev, [scope]: [...cursors, nextCursor] }));
            }}
            onPageSizeChange={setPageSize}
          />
        ) : null}
      </section>
    </div>
  );
}

/** Authentication activity for org owners and admins; filters live in the URL. */
export function AuthenticationActivityPage() {
  return (
    <AdminOrgManagePageFrame
      title="Authentication Activity"
      titleId="auth-activity-title"
      description="Sign-in, sign-out, password, and session events for organization members."
      requireManage={false}
    >
      <AuthenticationActivityContent />
    </AdminOrgManagePageFrame>
  );
}
