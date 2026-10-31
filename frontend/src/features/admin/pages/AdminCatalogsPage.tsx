import type { UseQueryResult } from '@tanstack/react-query';
import { useParams } from 'react-router';

import { Badge } from '../../../components/ui/Badge';
import { Card, EmptyState, Skeleton } from '../../../components/ui/Card';
import {
  DataGrid,
  DataGridBody,
  DataGridDividedCell,
  DataGridDividedHeadCell,
  DataGridEqualColumns,
  DataGridHead,
  DataGridRow,
  DataGridTable,
} from '../../../components/ui/DataGrid';
import { PageHeader } from '../../../components/ui/PageHeader';
import { ErrorState } from '../../../components/ui/States';
import type { IssueType, Priority } from '../../../lib/api/types';
import { useIssueTypes, usePriorities } from '../../issues/api';

function formatKind(kind: string): string {
  if (kind === 'subtask') return 'Sub-task';
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

function CatalogSectionSkeleton({ label }: { label: string }) {
  return (
    <Card className="admin-card space-y-4 p-5 sm:p-6">
      <Skeleton className="h-6 w-40" aria-hidden />
      <span className="sr-only">{label}</span>
      <Skeleton className="h-24 w-full" aria-hidden />
    </Card>
  );
}

function IssueTypesSection({ query }: { query: UseQueryResult<IssueType[]> }) {
  const titleId = 'admin-catalog-issue-types';
  if (query.isPending) {
    return <CatalogSectionSkeleton label="Loading issue types" />;
  }
  if (query.isError) {
    return (
      <section className="admin-card rounded-xl border p-5 sm:p-6" aria-labelledby={titleId}>
        <h2 id={titleId} className="text-lg font-semibold text-[var(--admin-text)]">
          Issue types
        </h2>
        <div className="mt-4">
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        </div>
      </section>
    );
  }

  const items = query.data;
  return (
    <section
      className="admin-card space-y-4 rounded-xl border p-5 sm:p-6"
      aria-labelledby={titleId}
    >
      <div>
        <h2 id={titleId} className="text-lg font-semibold text-[var(--admin-text)]">
          Issue types
        </h2>
        <p className="mt-1 text-sm text-[var(--admin-muted)]">
          Categories used when creating and classifying issues in this organization.
        </p>
      </div>
      {items.length === 0 ? (
        <EmptyState
          title="No issue types"
          description="This organization has no issue types configured yet."
        />
      ) : (
        <div className="min-w-0 overflow-x-auto">
          <DataGrid>
            <DataGridTable aria-label="Issue types">
              <DataGridEqualColumns columnCount={3}>
                <DataGridHead>
                  <DataGridDividedHeadCell>Name</DataGridDividedHeadCell>
                  <DataGridDividedHeadCell>Kind</DataGridDividedHeadCell>
                  <DataGridDividedHeadCell>Order</DataGridDividedHeadCell>
                </DataGridHead>
                <DataGridBody>
                  {items.map((row) => (
                    <DataGridRow key={row.id}>
                      <DataGridDividedCell>
                        <span className="font-medium text-[var(--admin-text)]">{row.name}</span>
                      </DataGridDividedCell>
                      <DataGridDividedCell>{formatKind(row.kind)}</DataGridDividedCell>
                      <DataGridDividedCell>
                        <span className="tabular-nums">{row.position}</span>
                      </DataGridDividedCell>
                    </DataGridRow>
                  ))}
                </DataGridBody>
              </DataGridEqualColumns>
            </DataGridTable>
          </DataGrid>
        </div>
      )}
    </section>
  );
}

function PrioritiesSection({ query }: { query: UseQueryResult<Priority[]> }) {
  const titleId = 'admin-catalog-priorities';
  if (query.isPending) {
    return <CatalogSectionSkeleton label="Loading priorities" />;
  }
  if (query.isError) {
    return (
      <section className="admin-card rounded-xl border p-5 sm:p-6" aria-labelledby={titleId}>
        <h2 id={titleId} className="text-lg font-semibold text-[var(--admin-text)]">
          Priorities
        </h2>
        <div className="mt-4">
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        </div>
      </section>
    );
  }

  const items = query.data;
  return (
    <section
      className="admin-card space-y-4 rounded-xl border p-5 sm:p-6"
      aria-labelledby={titleId}
    >
      <div>
        <h2 id={titleId} className="text-lg font-semibold text-[var(--admin-text)]">
          Priorities
        </h2>
        <p className="mt-1 text-sm text-[var(--admin-muted)]">
          Relative urgency levels available for issues in this organization.
        </p>
      </div>
      {items.length === 0 ? (
        <EmptyState
          title="No priorities"
          description="This organization has no priorities configured yet."
        />
      ) : (
        <div className="min-w-0 overflow-x-auto">
          <DataGrid>
            <DataGridTable aria-label="Priorities">
              <DataGridEqualColumns columnCount={3}>
                <DataGridHead>
                  <DataGridDividedHeadCell>Name</DataGridDividedHeadCell>
                  <DataGridDividedHeadCell>Order</DataGridDividedHeadCell>
                  <DataGridDividedHeadCell>Color</DataGridDividedHeadCell>
                </DataGridHead>
                <DataGridBody>
                  {items.map((row) => (
                    <DataGridRow key={row.id}>
                      <DataGridDividedCell>
                        <span className="font-medium text-[var(--admin-text)]">{row.name}</span>
                      </DataGridDividedCell>
                      <DataGridDividedCell>
                        <span className="tabular-nums">{row.sort_order}</span>
                      </DataGridDividedCell>
                      <DataGridDividedCell>
                        <span className="inline-flex items-center gap-2">
                          <span
                            className="size-4 shrink-0 rounded-sm border border-[var(--admin-border)]"
                            style={{ backgroundColor: row.color }}
                            aria-hidden
                          />
                          <span className="text-sm text-[var(--admin-muted)]">
                            <span className="sr-only">Color for {row.name}: </span>
                            {row.color}
                          </span>
                        </span>
                      </DataGridDividedCell>
                    </DataGridRow>
                  ))}
                </DataGridBody>
              </DataGridEqualColumns>
            </DataGridTable>
          </DataGrid>
        </div>
      )}
    </section>
  );
}

/** Read-only organization issue types and priorities (A1b). */
export function AdminCatalogsPage() {
  const { org: slug = '' } = useParams();
  const issueTypes = useIssueTypes(slug);
  const priorities = usePriorities(slug);

  return (
    <div className="admin-page space-y-6">
      <PageHeader
        titleId="admin-catalogs-title"
        title="Defaults & catalogs"
        description="Organization-scoped defaults seeded when the organization was created. Values apply across projects in this organization."
        actions={<Badge tone="neutral">Read-only</Badge>}
      />
      <p className="text-sm text-[var(--admin-muted)]">
        Catalog editing is not available in this release. Contact your platform administrator if you
        need changes to default issue types or priorities.
      </p>
      <div className="grid gap-6 lg:grid-cols-1">
        <IssueTypesSection query={issueTypes} />
        <PrioritiesSection query={priorities} />
      </div>
    </div>
  );
}
