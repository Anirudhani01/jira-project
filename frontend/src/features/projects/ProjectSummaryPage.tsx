import { BarChart3 } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';

import { NotFoundPage } from '../../app/pages/NotFoundPage';
import { EmptyState, Skeleton } from '../../components/ui/Card';
import { PriorityIcon, TypeIcon } from '../../components/ui/IssueIcons';
import { PageHeader } from '../../components/ui/PageHeader';
import { ErrorState } from '../../components/ui/States';
import { ApiError } from '../../lib/api/errors';
import { CreateIssueDialog } from '../issues/CreateIssueDialog';
import { useOrgFormatters } from '../orgs/useOrgFormatters';

import { useProject, useProjectSummary } from './api';
import { BreakdownList } from './BreakdownList';
import { StatusDistribution } from './StatusDistribution';
import {
  formatCount,
  groupByCategory,
  issueListHref,
  rankByCount,
  sharePercentLabel,
} from './summaryDistribution';

function StatTile({
  label,
  value,
  hint,
  to,
}: {
  label: string;
  value: string;
  hint: string;
  to: string;
}) {
  return (
    <Link
      to={to}
      className="block min-w-0 rounded-lg border border-line bg-surface p-3 no-underline shadow-sm transition-colors hover:bg-surface-hover sm:p-4"
    >
      <span className="block text-xs text-fg-muted sm:text-sm">{label}</span>{' '}
      <span className="mt-1 block text-2xl font-semibold text-fg sm:text-3xl">{value}</span>{' '}
      <span className="mt-1 block text-xs leading-snug text-fg-muted">{hint}</span>
    </Link>
  );
}

function SummarySkeleton() {
  return (
    <section aria-busy="true" className="w-full space-y-6">
      <Skeleton className="h-9 w-56" />
      <div className="grid grid-cols-3 gap-2 sm:gap-4">
        <Skeleton className="h-28 rounded-lg" />
        <Skeleton className="h-28 rounded-lg" />
        <Skeleton className="h-28 rounded-lg" />
      </div>
      <Skeleton className="h-72 rounded-lg" />
      <div className="grid gap-4 md:grid-cols-2">
        <Skeleton className="h-60 rounded-lg" />
        <Skeleton className="h-60 rounded-lg" />
      </div>
    </section>
  );
}

/** Project summary: headline numbers, the split across the workflow, and the mix of issue
 * types and priorities. Counts every issue of the project (backlog included). */
export function ProjectSummaryPage() {
  const { org = '', key = '' } = useParams();
  const project = useProject(org, key);
  const summary = useProjectSummary(org, key);
  const { locale } = useOrgFormatters();
  const [creating, setCreating] = useState(false);

  if (project.error instanceof ApiError && project.error.status === 404) return <NotFoundPage />;
  if (project.isError) {
    return (
      <ErrorState
        error={project.error}
        onRetry={() => {
          void project.refetch();
        }}
      />
    );
  }
  if (project.isPending) return <SummarySkeleton />;
  if (summary.error instanceof ApiError && summary.error.status === 404) return <NotFoundPage />;
  if (summary.isError) {
    return (
      <ErrorState
        error={summary.error}
        onRetry={() => {
          void summary.refetch();
        }}
      />
    );
  }
  if (summary.isPending) return <SummarySkeleton />;

  const projectKey = project.data.key;
  const { total, unassigned } = summary.data;
  const canCreate = project.data.permissions.includes('issue.create') && !project.data.archived;
  const groups = groupByCategory(summary.data.by_status);
  const done = groups.find((group) => group.category === 'done')?.count ?? 0;
  const number = (value: number) => formatCount(value, locale);
  const listHref = (filter?: Record<string, string>) => issueListHref(org, projectKey, filter);

  const types = rankByCount(
    summary.data.by_type.map((row) => ({
      id: row.type_id,
      name: row.name,
      count: row.count,
      active: row.active,
    })),
  );
  const kindByType = new Map(summary.data.by_type.map((row) => [row.type_id, row.kind]));
  const priorities = summary.data.by_priority.map((row) => ({
    id: row.priority_id,
    name: row.name,
    count: row.count,
    active: row.active,
  }));

  return (
    <section aria-labelledby="project-summary-title" className="w-full space-y-6">
      <PageHeader
        titleId="project-summary-title"
        title={`${projectKey} summary`}
        description="All issues of the project, including the backlog, epics and sub-tasks."
      />

      {total === 0 ? (
        <EmptyState
          icon={<BarChart3 className="size-8" aria-hidden="true" />}
          title="No issues yet"
          description={
            canCreate
              ? 'Create the first issue and its progress shows up here.'
              : 'Progress shows up here once issues are added to this project.'
          }
          {...(canCreate
            ? {
                action: {
                  label: 'Create issue',
                  onClick: () => {
                    setCreating(true);
                  },
                },
              }
            : {})}
        />
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2 sm:gap-4">
            <StatTile
              label="Total issues"
              value={number(total)}
              hint="Open the issue list"
              to={listHref()}
            />
            <StatTile
              label="Done"
              value={number(done)}
              hint={`${sharePercentLabel(done, total)} of all issues`}
              to={listHref({ status_category: 'done' })}
            />
            <StatTile
              label="Unassigned"
              value={number(unassigned)}
              hint="No assignee yet"
              to={listHref({ assignee: 'none' })}
            />
          </div>

          <StatusDistribution
            org={org}
            project={projectKey}
            groups={groups}
            total={total}
            locale={locale}
          />

          <div className="grid gap-4 md:grid-cols-2">
            <BreakdownList
              id="summary-types-title"
              title="Issue types"
              note="Largest first."
              rows={types}
              href={(row) => listHref({ type: row.id })}
              icon={(row) => (
                <TypeIcon name={row.name} kind={kindByType.get(row.id) ?? 'standard'} />
              )}
              locale={locale}
            />
            <BreakdownList
              id="summary-priorities-title"
              title="Priorities"
              note="Highest first."
              rows={priorities}
              href={(row) => listHref({ priority: row.id })}
              icon={(row) => <PriorityIcon name={row.name} />}
              locale={locale}
            />
          </div>
        </>
      )}

      {creating ? (
        <CreateIssueDialog
          org={org}
          project={projectKey}
          onClose={() => {
            setCreating(false);
          }}
        />
      ) : null}
    </section>
  );
}
