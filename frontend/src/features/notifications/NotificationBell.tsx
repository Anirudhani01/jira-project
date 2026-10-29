import { useState } from 'react';
import { Link, useParams } from 'react-router';

import type { Notification } from '../../lib/api/types';

import { useMarkRead, useNotifications, useUnreadCount } from './api';

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

/** Bell with an unread badge and a panel of the signed-in member's notifications. */
export function NotificationBell({ org }: { org: string }) {
  const [open, setOpen] = useState(false);
  const unread = useUnreadCount(org);
  const list = useNotifications(org, open);
  const { one, all } = useMarkRead(org);
  const count = unread.data ?? 0;

  return (
    <div className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="notification-panel"
        onClick={() => {
          setOpen((value) => !value);
        }}
        className="rounded px-2 py-1 hover:bg-slate-100"
      >
        Notifications
        {count > 0 ? (
          <span className="ml-1 rounded-full bg-red-600 px-1.5 text-xs text-white">
            <span className="sr-only">{count} unread</span>
            <span aria-hidden="true">{count > 99 ? '99+' : count}</span>
          </span>
        ) : null}
      </button>
      {open ? (
        <div
          id="notification-panel"
          role="region"
          aria-label="Notifications"
          className="absolute right-0 z-10 mt-1 w-80 rounded border border-slate-200 bg-white p-2 shadow-lg"
        >
          <div className="mb-2 flex justify-between text-xs">
            <span className="font-semibold">Notifications</span>
            <button
              type="button"
              disabled={count === 0}
              onClick={() => {
                all.mutate();
              }}
              className="text-blue-700 underline disabled:text-slate-400 disabled:no-underline"
            >
              Mark all read
            </button>
          </div>
          {list.isPending ? <p className="text-sm">Loading…</p> : null}
          {list.isError ? (
            <p className="text-sm text-red-700">Could not load notifications.</p>
          ) : null}
          {list.data && list.data.items.length === 0 ? (
            <p className="text-sm text-slate-600">You are all caught up.</p>
          ) : null}
          <ul className="max-h-96 space-y-1 overflow-y-auto">
            {list.data?.items.map((n) => (
              <li key={n.id}>
                <Link
                  to={`/o/${org}/issues/${n.issue_key}`}
                  onClick={() => {
                    if (!n.read) one.mutate(n.id);
                    setOpen(false);
                  }}
                  className={`block rounded px-2 py-1 text-sm hover:bg-slate-100 ${n.read ? 'text-slate-600' : 'font-medium'}`}
                >
                  {n.read ? null : <span className="sr-only">Unread: </span>}
                  {describe(n)}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export function OrgNotificationBell() {
  const { org } = useParams();
  return org ? <NotificationBell org={org} /> : null;
}
