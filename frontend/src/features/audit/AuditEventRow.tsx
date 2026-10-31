import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '../../components/ui/Badge';
import type { AuditEvent, Member } from '../../lib/api/types';

import { formatAuditActor } from './auditActorLabel';

export function AuditEventRow({
  event,
  memberById,
  membersLoaded,
}: {
  event: AuditEvent;
  memberById: Map<string, Member>;
  membersLoaded: boolean;
}) {
  const [open, setOpen] = useState(false);
  const entries = Object.entries(event.metadata);
  const targetText = event.target_type
    ? `${event.target_type} ${event.target_id ?? ''}`.trim()
    : null;

  return (
    <>
      <tr className="border-b border-[var(--admin-border)] align-top">
        <td className="py-2 pr-3 whitespace-nowrap text-[var(--admin-muted)]">
          {new Date(event.created_at).toLocaleString()}
        </td>
        <td className="pr-3 text-[var(--admin-text)]">
          {formatAuditActor(event.actor_user_id, memberById, membersLoaded)}
        </td>
        <td className="pr-3 font-mono text-[var(--admin-text)]">{event.action}</td>
        <td className="pr-3">
          <Badge tone={event.outcome === 'success' ? 'success' : 'danger'}>{event.outcome}</Badge>
        </td>
        <td className="hidden max-w-[10rem] pr-3 break-words text-[var(--admin-text)] sm:table-cell sm:max-w-none">
          {targetText ?? '—'}
        </td>
        <td className="max-w-[14rem] font-mono text-xs break-all text-[var(--admin-muted)] sm:max-w-md">
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
                className="mr-1 inline-flex align-middle text-[var(--admin-muted)] hover:text-[var(--admin-text)]"
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
        <tr className="border-b border-[var(--admin-border)] bg-[var(--admin-surface)]">
          <td colSpan={6} className="px-3 py-2">
            {targetText ? (
              <p className="mb-2 text-sm text-[var(--admin-muted)] sm:hidden">
                Target: {targetText}
              </p>
            ) : null}
            <pre className="overflow-x-auto font-mono text-xs text-[var(--admin-text)]">
              {JSON.stringify(event.metadata, null, 2)}
            </pre>
            {event.request_id ? (
              <p className="mt-1 text-xs text-[var(--admin-muted)]">Request {event.request_id}</p>
            ) : null}
          </td>
        </tr>
      ) : null}
    </>
  );
}
