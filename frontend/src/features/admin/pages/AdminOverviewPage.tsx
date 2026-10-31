import type { UseQueryResult } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';

import { Skeleton } from '../../../components/ui/Card';
import { PageHeader } from '../../../components/ui/PageHeader';
import { Button } from '../../../components/ui/Button';
import { describeError } from '../../../lib/forms';
import { useInvitations, useMembers, useOrg } from '../../orgs/api';
import { useProjects } from '../../projects/api';
import {
  adminNavGroups,
  filterAdminNavGroups,
  type AdminNavGroup,
  type AdminNavItem,
} from '../adminNav';

function OverviewStat({
  label,
  value,
  isPending,
  isError,
  error,
  onRetry,
  emptyHint,
}: {
  label: string;
  value: number | null;
  isPending: boolean;
  isError: boolean;
  error: unknown;
  onRetry?: () => void;
  emptyHint?: string;
}) {
  const statId = `admin-overview-stat-${label.replace(/\s+/g, '-').toLowerCase()}`;
  return (
    <div
      className="admin-card rounded-lg border px-4 py-3 shadow-sm"
      aria-labelledby={statId}
      role="group"
    >
      <p id={statId} className="text-xs font-medium text-[var(--admin-muted)]">
        {label}
      </p>
      {isPending ? (
        <Skeleton className="mt-2 h-7 w-12" aria-hidden />
      ) : isError ? (
        <div className="mt-2 space-y-2">
          <p className="text-sm text-[var(--admin-text)]">{describeError(error)}</p>
          {onRetry ? (
            <Button type="button" variant="secondary" size="sm" onClick={onRetry}>
              Retry
            </Button>
          ) : null}
        </div>
      ) : (
        <>
          <p className="mt-1 text-xl font-semibold tabular-nums text-[var(--admin-text)]">
            {value ?? '—'}
          </p>
          {emptyHint && value === 0 ? (
            <p className="mt-1 text-xs text-[var(--admin-muted)]">{emptyHint}</p>
          ) : null}
        </>
      )}
    </div>
  );
}

function countQuery<T>(query: UseQueryResult<T[]>): {
  isPending: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => void;
  count: number | null;
} {
  return {
    isPending: query.isPending,
    isError: query.isError,
    error: query.error,
    refetch: () => void query.refetch(),
    count: query.isSuccess ? query.data.length : null,
  };
}

function QuickLink({ item }: { item: AdminNavItem }) {
  const Icon = item.icon;
  const hash = item.to.includes('#') ? item.to.split('#')[1] : undefined;
  const pathname = item.to.split('#')[0] ?? item.to;
  const to = hash ? { pathname, hash: `#${hash}` } : pathname;
  return (
    <Link
      to={to}
      className="flex items-center gap-2.5 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] px-3 py-2.5 text-sm font-medium text-[var(--admin-text)] no-underline shadow-sm transition-colors hover:border-[var(--admin-accent)] hover:bg-[var(--admin-accent-soft)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--admin-accent)]"
    >
      <Icon className="size-4 shrink-0 text-[var(--admin-accent-on-soft)]" aria-hidden />
      <span>{item.label}</span>
    </Link>
  );
}

function AdminQuickLinks({ groups }: { groups: AdminNavGroup[] }) {
  if (groups.length === 0) {
    return (
      <p className="text-sm text-[var(--admin-muted)]">
        No additional administration areas are available for your role.
      </p>
    );
  }
  return (
    <div className="space-y-5">
      {groups.map((group) => (
        <div key={group.id}>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--admin-muted)]">
            {group.label}
          </h3>
          <ul className="grid gap-2 sm:grid-cols-2">
            {group.items.map((item) => (
              <li key={item.id}>
                <QuickLink item={item} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** Administration landing page with independent org statistics (A1b). */
export function AdminOverviewPage() {
  const { org: slug = '' } = useParams();
  const org = useOrg(slug);
  const members = useMembers(slug);
  const projects = useProjects(slug);
  const permissions = org.data?.permissions ?? [];
  const canManageMembers = permissions.includes('org.members.manage');
  const invitations = useInvitations(slug, org.isSuccess && canManageMembers);

  const memberStat = countQuery(members);
  const projectStat = countQuery(projects);
  const invitationStat = countQuery(invitations);

  const quickLinkGroups = filterAdminNavGroups(adminNavGroups(slug), permissions)
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => item.id !== 'overview'),
    }))
    .filter((group) => group.items.length > 0);

  return (
    <div className="admin-page space-y-6">
      <PageHeader
        titleId="admin-overview-title"
        title="Administration overview"
        description="Summary of this organization and shortcuts to administration areas you can access."
      />

      <section
        className="admin-card space-y-2 rounded-xl border p-5 sm:p-6"
        aria-labelledby="admin-overview-context"
      >
        <h2 id="admin-overview-context" className="text-lg font-semibold text-[var(--admin-text)]">
          Organization
        </h2>
        {org.isPending ? (
          <>
            <Skeleton className="h-6 w-48" aria-hidden />
            <Skeleton className="h-4 w-32" aria-hidden />
          </>
        ) : org.isSuccess ? (
          <>
            <p className="text-base font-medium text-[var(--admin-text)]">{org.data.name}</p>
            <p className="text-sm text-[var(--admin-muted)]">
              Workspace address:{' '}
              <code className="rounded bg-[var(--admin-bg)] px-1.5 py-0.5 text-[var(--admin-text)]">
                /o/{org.data.slug}
              </code>
              {' · '}
              Your role: <span className="capitalize">{org.data.role}</span>
            </p>
          </>
        ) : null}
      </section>

      <section aria-labelledby="admin-overview-stats-heading" className="space-y-3">
        <h2
          id="admin-overview-stats-heading"
          className="text-sm font-semibold text-[var(--admin-text)]"
        >
          At a glance
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <OverviewStat
            label="Members"
            value={memberStat.count}
            isPending={memberStat.isPending}
            isError={memberStat.isError}
            error={memberStat.error}
            onRetry={memberStat.refetch}
            emptyHint="No members listed yet."
          />
          <OverviewStat
            label="Projects you can access"
            value={projectStat.count}
            isPending={projectStat.isPending}
            isError={projectStat.isError}
            error={projectStat.error}
            onRetry={projectStat.refetch}
            emptyHint="You are not on any active projects yet."
          />
          {canManageMembers ? (
            <OverviewStat
              label="Pending invitations"
              value={invitationStat.count}
              isPending={invitationStat.isPending}
              isError={invitationStat.isError}
              error={invitationStat.error}
              onRetry={invitationStat.refetch}
              emptyHint="No outstanding invitations."
            />
          ) : null}
        </div>
      </section>

      <section
        className="admin-card space-y-4 rounded-xl border p-5 sm:p-6"
        aria-labelledby="admin-overview-links"
      >
        <h2 id="admin-overview-links" className="text-lg font-semibold text-[var(--admin-text)]">
          Administration areas
        </h2>
        <AdminQuickLinks groups={quickLinkGroups} />
      </section>
    </div>
  );
}
