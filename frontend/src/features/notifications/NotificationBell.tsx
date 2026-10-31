import { ArrowRightLeft, Bell, MessageSquare, UserPlus, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';

import { Button } from '../../components/ui/Button';
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/Overlay';
import { ErrorState } from '../../components/ui/States';
import { cn } from '../../lib/cn';
import type { Notification } from '../../lib/api/types';
import { formatRelativeTime } from '../../lib/relativeTime';

import { useMarkRead, useNotifications, useUnreadCount } from './api';
import { groupNotifications, notificationHref } from './notificationGroups';

function describe(n: Notification): string {
  const who = n.actor.display_name;
  const payload = n.payload as { from?: string | null; to?: string };
  switch (n.type) {
    case 'issue_assigned':
      return `${who} assigned you ${n.issue_key}`;
    case 'issue_commented':
      return `${who} commented on ${n.issue_key}`;
    case 'issue_status_changed':
      return `${who} moved ${n.issue_key} from ${payload.from ?? '—'} to ${payload.to ?? '—'}`;
    default:
      return `${who} updated ${n.issue_key}`;
  }
}

const ICONS: Record<string, LucideIcon> = {
  issue_assigned: UserPlus,
  issue_commented: MessageSquare,
  issue_status_changed: ArrowRightLeft,
};

/** Bell with an unread badge and a popover of the signed-in member's notifications. */
export function NotificationBell({ org }: { org: string }) {
  const [open, setOpen] = useState(false);
  const unread = useUnreadCount(org);
  const list = useNotifications(org, open);
  const { one, all } = useMarkRead(org);
  const count = unread.data ?? 0;
  const groups = groupNotifications(list.data?.items ?? []);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="relative gap-1 px-2">
          <Bell className="size-4" aria-hidden="true" />
          <span className="sr-only">Notifications</span>
          {count > 0 ? (
            <span className="rounded-full bg-danger px-1.5 text-xs font-medium text-white">
              <span className="sr-only">{count} unread</span>
              <span aria-hidden="true">{count > 99 ? '99+' : count}</span>
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent aria-label="Notifications" className="w-96 max-w-[calc(100vw-1rem)] p-0">
        <div className="flex items-center justify-between border-b border-line px-3 py-2">
          <h2 className="text-sm font-semibold text-fg">Notifications</h2>
          <button
            type="button"
            disabled={count === 0 || all.isPending}
            onClick={() => {
              all.mutate();
            }}
            className="text-xs font-medium text-accent hover:underline disabled:text-fg-subtle disabled:no-underline"
          >
            Mark all read
          </button>
        </div>
        <div className="max-h-96 overflow-y-auto p-2">
          {list.isPending ? <p className="px-2 py-3 text-sm text-fg-muted">Loading…</p> : null}
          {list.isError ? (
            <ErrorState
              error={list.error}
              onRetry={() => {
                void list.refetch();
              }}
            />
          ) : null}
          {list.data && groups.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-fg-muted">You are all caught up.</p>
          ) : null}
          {groups.map((group) => (
            <section key={group.label} aria-label={group.label} className="mb-2 last:mb-0">
              <h3 className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-fg-muted">
                {group.label}
              </h3>
              <ul className="space-y-0.5">
                {group.items.map((n) => {
                  const Icon = ICONS[n.type] ?? Bell;
                  return (
                    <li key={n.id}>
                      <Link
                        to={notificationHref(org, n)}
                        onClick={() => {
                          if (!n.read) one.mutate(n.id);
                          setOpen(false);
                        }}
                        className={cn(
                          'flex items-start gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-surface-2',
                          n.read ? 'text-fg-muted' : 'font-medium text-fg',
                        )}
                      >
                        <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                        <span className="min-w-0 flex-1">
                          {n.read ? null : <span className="sr-only">Unread: </span>}
                          {describe(n)}
                          <span className="block text-xs font-normal text-fg-subtle">
                            {formatRelativeTime(n.created_at)}
                          </span>
                        </span>
                        {n.read ? null : (
                          <span
                            aria-hidden="true"
                            className="mt-1.5 size-2 shrink-0 rounded-full bg-accent"
                          />
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function OrgNotificationBell() {
  const { org } = useParams();
  return org ? <NotificationBell org={org} /> : null;
}
