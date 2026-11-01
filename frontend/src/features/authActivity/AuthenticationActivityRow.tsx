import { ChevronDown, ChevronRight } from 'lucide-react';
import { useId, useState } from 'react';

import { Badge } from '../../components/ui/Badge';
import type { AuthenticationActivityItem } from '../../lib/api/types';

import {
  authActivityDetailsSummary,
  authActivityRowLabel,
  authActivitySafeMetadata,
} from './authActivityDetails';
import { authActivityEventTone, formatAuthActivityEventType } from './authActivityEventTypes';

function EventBadge({ eventType }: { eventType: string }) {
  return (
    <Badge tone={authActivityEventTone(eventType)}>{formatAuthActivityEventType(eventType)}</Badge>
  );
}

function MemberCell({ item }: { item: AuthenticationActivityItem }) {
  return (
    <div className="min-w-0">
      <p className="truncate font-medium text-[var(--admin-text)]" title={item.member_display_name}>
        {item.member_display_name}
      </p>
      {item.member_status === 'removed' ? (
        <Badge tone="neutral" className="mt-1 normal-case tracking-normal">
          Removed
        </Badge>
      ) : null}
    </div>
  );
}

function ExpandableDetails({
  item,
  open,
  onToggle,
}: {
  item: AuthenticationActivityItem;
  open: boolean;
  onToggle: () => void;
}) {
  const panelId = useId();
  const safeMeta = authActivitySafeMetadata(item);
  const entries = Object.entries(safeMeta);
  const summary = authActivityDetailsSummary(item);

  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-start gap-1">
        {entries.length > 0 ? (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={panelId}
            aria-label={`${open ? 'Hide' : 'Show'} metadata for ${authActivityRowLabel(item)}`}
            onClick={onToggle}
            className="mt-0.5 shrink-0 rounded text-[var(--admin-muted)] hover:text-[var(--admin-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--admin-accent)]"
          >
            {open ? (
              <ChevronDown className="size-3.5" aria-hidden="true" />
            ) : (
              <ChevronRight className="size-3.5" aria-hidden="true" />
            )}
          </button>
        ) : null}
        <p className="min-w-0 text-xs break-words text-[var(--admin-muted)] sm:text-sm">
          {summary}
        </p>
      </div>
      {open && entries.length > 0 ? (
        <pre
          id={panelId}
          className="mt-2 overflow-x-auto rounded-md border border-[var(--admin-border)] bg-[var(--admin-surface)] p-2 font-mono text-xs text-[var(--admin-text)]"
        >
          {JSON.stringify(safeMeta, null, 2)}
        </pre>
      ) : null}
    </div>
  );
}

export function AuthenticationActivityTableRow({ item }: { item: AuthenticationActivityItem }) {
  const [open, setOpen] = useState(false);
  const timestamp = new Date(item.occurred_at).toLocaleString();

  return (
    <tr className="border-b border-[var(--admin-border)] align-top">
      <td className="hidden max-w-[12rem] py-2 pr-3 sm:table-cell">
        <MemberCell item={item} />
      </td>
      <td className="hidden py-2 pr-3 sm:table-cell">
        <EventBadge eventType={item.event_type} />
      </td>
      <td className="hidden py-2 pr-3 whitespace-nowrap text-[var(--admin-muted)] sm:table-cell">
        {timestamp}
      </td>
      <td className="py-2 pr-0 sm:pr-3">
        <ExpandableDetails
          item={item}
          open={open}
          onToggle={() => {
            setOpen((value) => !value);
          }}
        />
      </td>
    </tr>
  );
}

/** Compact card layout for narrow viewports. */
export function AuthenticationActivityMobileCard({ item }: { item: AuthenticationActivityItem }) {
  const [open, setOpen] = useState(false);
  const timestamp = new Date(item.occurred_at).toLocaleString();

  return (
    <article
      className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3 shadow-sm"
      aria-label={authActivityRowLabel(item)}
    >
      <div className="flex items-start justify-between gap-2">
        <MemberCell item={item} />
        <time className="shrink-0 text-xs whitespace-nowrap text-[var(--admin-muted)]">
          {timestamp}
        </time>
      </div>
      <div className="mt-2">
        <EventBadge eventType={item.event_type} />
      </div>
      <div className="mt-3">
        <ExpandableDetails
          item={item}
          open={open}
          onToggle={() => {
            setOpen((value) => !value);
          }}
        />
      </div>
    </article>
  );
}
