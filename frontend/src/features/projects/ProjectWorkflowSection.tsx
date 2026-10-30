import { Card, Skeleton } from '../../components/ui/Card';
import {
  DataGrid,
  DataGridBody,
  DataGridDividedCell,
  DataGridDividedHeadCell,
  DataGridEqualColumns,
  DataGridHead,
  DataGridRow,
  DataGridTable,
} from '../../components/ui/DataGrid';
import { StatusLozenge } from '../../components/ui/IssueIcons';
import { ErrorState } from '../../components/ui/States';
import type { Workflow } from '../../lib/api/types';

export function ProjectWorkflowSection({
  workflow,
}: {
  workflow: {
    isPending: boolean;
    isError: boolean;
    error: unknown;
    data: Workflow | undefined;
  };
}) {
  if (workflow.isPending) {
    return (
      <Card className="space-y-4 p-5 sm:p-6">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-8 w-full max-w-md" />
        <Skeleton className="h-24 w-full" />
      </Card>
    );
  }
  if (workflow.isError) return <ErrorState error={workflow.error} />;

  const data = workflow.data;
  const statusName = new Map((data?.statuses ?? []).map((s) => [s.id, s.name]));
  const statusCategory = new Map((data?.statuses ?? []).map((s) => [s.id, s.category]));

  return (
    <Card className="space-y-5 p-5 sm:p-6" aria-labelledby="workflow-title">
      <div>
        <h2 id="workflow-title" className="text-lg font-semibold text-fg">
          Workflow
        </h2>
        <p className="mt-1 text-sm text-fg-muted">Statuses and how they map to board columns.</p>
      </div>

      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Statuses</h3>
        <ul className="flex flex-wrap gap-2">
          {(data?.statuses ?? []).map((s) => (
            <li key={s.id}>
              <StatusLozenge name={s.name} category={s.category} />
            </li>
          ))}
        </ul>
      </div>

      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
          Board columns
        </h3>
        {(data?.columns ?? []).length === 0 ? (
          <p className="text-sm text-fg-muted">No columns configured.</p>
        ) : (
          <DataGrid>
            <DataGridTable aria-label="Board columns">
              <DataGridEqualColumns columnCount={2}>
                <DataGridHead>
                  <DataGridDividedHeadCell>Column</DataGridDividedHeadCell>
                  <DataGridDividedHeadCell>Statuses</DataGridDividedHeadCell>
                </DataGridHead>
                <DataGridBody>
                  {(data?.columns ?? []).map((column) => (
                    <DataGridRow key={column.position}>
                      <DataGridDividedCell>
                        <span className="font-medium text-fg">{column.name}</span>
                      </DataGridDividedCell>
                      <DataGridDividedCell>
                        <ul className="flex flex-wrap gap-2">
                          {column.status_ids.map((id) => {
                            const known = statusName.has(id);
                            const name = known
                              ? (statusName.get(id) as string)
                              : `Unknown (${id.slice(0, 8)}…)`;
                            const category = statusCategory.get(id) ?? 'todo';
                            return (
                              <li key={id}>
                                <StatusLozenge name={name} category={category} />
                              </li>
                            );
                          })}
                        </ul>
                      </DataGridDividedCell>
                    </DataGridRow>
                  ))}
                </DataGridBody>
              </DataGridEqualColumns>
            </DataGridTable>
          </DataGrid>
        )}
      </div>
    </Card>
  );
}
