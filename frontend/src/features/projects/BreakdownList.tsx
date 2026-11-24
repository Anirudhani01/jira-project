import type { ReactNode } from 'react';
import { Link } from 'react-router';

import { Card } from '../../components/ui/Card';

import { barWidth, formatCount, type BreakdownRow } from './summaryDistribution';

/** Ranked horizontal bars: one row per entry, name on the left, the count at the end of the
 * bar. The row is a link to the issue list with the same filter; the bar is decorative. */
export function BreakdownList({
  id,
  title,
  note,
  rows,
  href,
  icon,
  locale,
}: {
  id: string;
  title: string;
  note: string;
  rows: BreakdownRow[];
  href: (row: BreakdownRow) => string;
  icon: (row: BreakdownRow) => ReactNode;
  locale: string;
}) {
  const max = rows.reduce((largest, row) => Math.max(largest, row.count), 0);

  return (
    <Card className="space-y-3 p-5" role="region" aria-labelledby={id}>
      <div className="space-y-1">
        <h2 id={id} className="text-base font-medium text-fg">
          {title}
        </h2>
        <p className="text-sm text-fg-muted">{note}</p>
      </div>
      <ul className="space-y-0.5">
        {rows.map((row) => (
          <li key={row.id}>
            <Link
              to={href(row)}
              className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_auto] items-center gap-3 rounded-md px-1 py-1.5 text-sm text-fg no-underline hover:bg-surface-hover"
            >
              <span className="flex min-w-0 items-center gap-2">
                {icon(row)}
                <span className="truncate">
                  {row.name}
                  {row.active ? '' : ' (inactive)'}
                </span>
              </span>{' '}
              <span aria-hidden="true" className="h-2 overflow-hidden rounded-[4px] bg-surface-2">
                <span
                  className="block h-full rounded-[4px] bg-accent"
                  style={{ width: `${String(barWidth(row.count, max))}%` }}
                />
              </span>{' '}
              <span className="min-w-6 text-right tabular-nums">
                {formatCount(row.count, locale)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
