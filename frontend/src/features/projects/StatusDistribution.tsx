import { Fragment } from 'react';
import { Link } from 'react-router';

import { Card } from '../../components/ui/Card';
import { StatusLozenge } from '../../components/ui/IssueIcons';
import { Tooltip } from '../../components/ui/Overlay';

import {
  CATEGORY_COLOR,
  formatCount,
  issueListHref,
  segmentWidths,
  sharePercentLabel,
  summaryText,
  type CategoryGroup,
} from './summaryDistribution';

/** How the issues of a project split across the workflow: a thin bar of the three status
 * categories above a table with every status. The table is the text version of the bar. */
export function StatusDistribution({
  org,
  project,
  groups,
  total,
  locale,
}: {
  org: string;
  project: string;
  groups: CategoryGroup[];
  total: number;
  locale: string;
}) {
  const widths = segmentWidths(groups.map((group) => group.count));
  const number = (value: number) => formatCount(value, locale);
  const categoryHref = (group: CategoryGroup) =>
    issueListHref(org, project, { status_category: group.category });

  return (
    <Card className="space-y-4 p-5" role="region" aria-labelledby="summary-status-title">
      <div className="space-y-1">
        <h2 id="summary-status-title" className="text-base font-medium text-fg">
          Status distribution
        </h2>
        <p className="text-sm text-fg-muted">
          Where the {number(total)} {total === 1 ? 'issue is' : 'issues are'} in the workflow.
        </p>
      </div>

      {/* The bar is decorative: its text alternative is the label, and every figure is also in
          the legend and the table below. Segments are 2 px apart; the tooltip only adds detail. */}
      <div
        role="img"
        aria-label={summaryText(groups, total)}
        className="flex h-2 w-full gap-0.5 overflow-hidden rounded-[4px]"
      >
        {groups.map((group, index) => (
          <Tooltip
            key={group.category}
            label={`${group.label}: ${number(group.count)} (${sharePercentLabel(group.count, total)})`}
          >
            <span
              className="block h-full"
              style={{
                width: `${String(widths[index] ?? 0)}%`,
                background: CATEGORY_COLOR[group.category],
              }}
            />
          </Tooltip>
        ))}
      </div>

      <ul className="flex flex-wrap gap-x-5 gap-y-1" aria-label="Status categories">
        {groups.map((group) => (
          <li key={group.category}>
            <Link
              to={categoryHref(group)}
              className="inline-flex items-center gap-2 rounded-md py-1 text-sm text-fg no-underline hover:text-accent"
            >
              <span
                aria-hidden="true"
                className="size-2.5 rounded-sm"
                style={{ background: CATEGORY_COLOR[group.category] }}
              />
              {group.label}{' '}
              <span className="tabular-nums text-fg-muted">{number(group.count)}</span>
            </Link>
          </li>
        ))}
      </ul>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[16rem] text-sm">
          <caption className="sr-only">Issues by status, grouped by status category</caption>
          <thead>
            <tr className="text-left text-xs font-medium text-fg-muted">
              <th scope="col" className="pb-1 font-medium">
                Status
              </th>
              <th scope="col" className="pb-1 text-right font-medium">
                Issues
              </th>
              <th scope="col" className="pb-1 text-right font-medium">
                Share
              </th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => (
              <Fragment key={group.category}>
                <tr>
                  <th
                    scope="rowgroup"
                    colSpan={3}
                    className="pb-1 pt-3 text-left text-xs font-medium text-fg-muted"
                  >
                    <Link to={categoryHref(group)} className="no-underline hover:text-accent">
                      {group.label}
                    </Link>
                  </th>
                </tr>
                {group.statuses.map((status) => (
                  <tr key={status.status_id} className="border-t border-line">
                    <th scope="row" className="py-1.5 text-left font-normal">
                      <StatusLozenge name={status.name} category={status.category} />
                    </th>
                    <td className="py-1.5 text-right tabular-nums">{number(status.count)}</td>
                    <td className="py-1.5 text-right tabular-nums text-fg-muted">
                      {sharePercentLabel(status.count, total)}
                    </td>
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
