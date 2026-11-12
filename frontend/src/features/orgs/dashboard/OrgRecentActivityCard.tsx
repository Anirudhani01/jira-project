import { Link } from 'react-router';

import { Card } from '../../../components/ui/Card';
import { ErrorState, LoadingState } from '../../../components/ui/States';
import { cn } from '../../../lib/cn';
import type { AuditEvent, Member } from '../../../lib/api/types';
import { useAuditEvents } from '../../audit/api';

import { useOrgFormatters } from '../useOrgFormatters';

import { describeAuditEvent, memberDisplayNameByUserId } from './formatAuditActivity';

const PREVIEW_LIMIT = 5;

function ActivityRow({
  event,
  membersById,
  latest,
}: {
  event: AuditEvent;
  membersById: Map<string, string>;
  latest: boolean;
}) {
  const orgFormat = useOrgFormatters();
  return (
    <li className="relative pb-5 pl-4 last:pb-0">
      <span
        aria-hidden
        className={cn(
          'absolute -left-[7px] top-1.5 size-3 rounded-full border-2 border-[var(--org-dash-surface)]',
          latest ? 'bg-[var(--org-dash-accent)]' : 'bg-fg-subtle',
        )}
      />
      <p className="text-sm leading-snug text-[var(--org-dash-text)]">
        {describeAuditEvent(event, membersById)}
      </p>
      <time className="text-[13px] text-[var(--org-dash-muted)]" dateTime={event.created_at}>
        {orgFormat.formatRelativeTime(event.created_at)}
      </time>
    </li>
  );
}

function AuditActivityPreview({
  orgSlug,
  members,
  membersPending,
}: {
  orgSlug: string;
  members: Member[] | undefined;
  membersPending: boolean;
}) {
  const events = useAuditEvents(orgSlug, {}, true);
  const membersById = memberDisplayNameByUserId(members ?? []);
  const items = events.data?.pages[0]?.items.slice(0, PREVIEW_LIMIT) ?? [];

  return (
    <>
      {events.isPending || membersPending ? <LoadingState label="Loading activity" /> : null}
      {events.isError ? <ErrorState error={events.error} /> : null}
      {events.isSuccess && items.length === 0 ? (
        <p className="mt-3 text-sm text-[var(--org-dash-muted)]">No recent activity yet.</p>
      ) : null}
      {items.length > 0 ? (
        <ol className="ml-[5px] mt-4 border-l-2 border-[var(--org-dash-border)]">
          {items.map((event, index) => (
            <ActivityRow
              key={event.id}
              event={event}
              membersById={membersById}
              latest={index === 0}
            />
          ))}
        </ol>
      ) : null}
    </>
  );
}

export function OrgRecentActivityCard({
  orgSlug,
  canViewAudit,
  members,
  membersPending,
}: {
  orgSlug: string;
  canViewAudit: boolean;
  members: Member[] | undefined;
  membersPending: boolean;
}) {
  if (!canViewAudit) {
    return (
      <Card className="org-dash-card p-5">
        <h2 className="text-base font-semibold text-[var(--org-dash-text)]">Activity</h2>
        <p className="mt-2 text-sm text-[var(--org-dash-muted)]">
          Activity is visible to organization owners and admins.
        </p>
      </Card>
    );
  }

  return (
    <Card className="org-dash-card p-5">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-[var(--org-dash-text)]">Activity</h2>
        <Link
          to={`/o/${orgSlug}/settings/audit`}
          className="org-dash-link text-[13px] font-medium no-underline hover:underline"
        >
          View all
        </Link>
      </div>
      <AuditActivityPreview orgSlug={orgSlug} members={members} membersPending={membersPending} />
    </Card>
  );
}
