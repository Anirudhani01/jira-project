import { Link, useLocation } from 'react-router';

import { StatusLozenge } from '../../components/ui/IssueIcons';
import type { Issue } from '../../lib/api/types';

import { issueDetailLinkProps, issueDetailPath } from './issueDetailNavigation';

export function IssueChildrenSection({
  org,
  presentation,
  items,
  done,
  total,
}: {
  org: string;
  presentation: 'page' | 'modal';
  items: Issue[];
  done: number;
  total: number;
}) {
  const location = useLocation();
  if (total === 0) return null;

  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h2 id="children-title" className="text-base font-semibold text-fg">
          Child work items
        </h2>
        <p className="text-sm text-fg-muted">
          {done} of {total} done ({pct}%)
        </p>
      </div>
      <div
        className="h-2 overflow-hidden rounded-full bg-surface-raised"
        role="progressbar"
        aria-valuenow={done}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-label={`${done} of ${total} child issues done`}
      >
        <div
          className="h-full rounded-full bg-accent transition-[width]"
          style={{ width: `${String(pct)}%` }}
        />
      </div>
      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full min-w-[28rem] text-left text-sm">
          <thead className="border-b border-line bg-surface-raised text-xs font-medium text-fg-muted">
            <tr>
              <th className="px-3 py-2 font-medium">Key</th>
              <th className="px-3 py-2 font-medium">Summary</th>
              <th className="px-3 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {items.map((child) => (
              <tr key={child.id} className="border-b border-line last:border-b-0">
                <td className="px-3 py-2 font-mono text-xs">
                  <Link
                    className="font-medium text-accent hover:underline"
                    {...(presentation === 'modal'
                      ? issueDetailLinkProps(org, child.key, location)
                      : { to: issueDetailPath(org, child.key) })}
                  >
                    {child.key}
                  </Link>
                </td>
                <td className="max-w-[16rem] truncate px-3 py-2 text-fg">{child.summary}</td>
                <td className="px-3 py-2">
                  <StatusLozenge name={child.status.name} category={child.status.category} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
