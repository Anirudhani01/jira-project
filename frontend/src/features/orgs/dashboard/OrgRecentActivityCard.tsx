import { Link } from 'react-router';

import { Avatar } from '../../../components/ui/Avatar';
import { Card } from '../../../components/ui/Card';
import { ErrorState, LoadingState } from '../../../components/ui/States';
import type { AuditEvent, Member } from '../../../lib/api/types';
import { useAuditEvents } from '../../audit/api';

import {
  describeAuditEvent,
  formatRelativeTime,
  memberDisplayNameByUserId,
} from './formatAuditActivity';

const PREVIEW_LIMIT = 5;

function ActivityRow({
  event,
  membersById,
}: {
  event: AuditEvent;
  membersById: Map<string, string>;
}) {
  const name = event.actor_user_id
    ? (membersById.get(event.actor_user_id) ?? 'Team member')
    : 'System';
  return (
    <li className="flex gap-2.5 border-b border-[var(--org-dash-border)] py-3 last:border-0">
      <Avatar name={name} size="sm" className="shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-snug text-[var(--org-dash-text)]">
          {describeAuditEvent(event, membersById)}
        </p>
        <time className="text-xs text-[var(--org-dash-muted)]" dateTime={event.created_at}>
          {formatRelativeTime(event.created_at)}
        </time>
      </div>
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
        <ul className="mt-1 divide-y divide-[var(--org-dash-border)]">
          {items.map((event) => (
            <ActivityRow key={event.id} event={event} membersById={membersById} />
          ))}
        </ul>
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
      <Card className="org-dash-card p-4">
        <h2 className="text-sm font-semibold text-[var(--org-dash-text)]">Recent activity</h2>
        <p className="mt-2 text-sm text-[var(--org-dash-muted)]">
          Activity is visible to organization owners and admins.
        </p>
      </Card>
    );
  }

  return (
    <Card className="org-dash-card p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-[var(--org-dash-text)]">Recent activity</h2>
        <Link
          to={`/o/${orgSlug}/settings/audit`}
          className="org-dash-link text-xs font-medium no-underline hover:underline"
        >
          View all
        </Link>
      </div>
      <AuditActivityPreview orgSlug={orgSlug} members={members} membersPending={membersPending} />
    </Card>
  );
}
