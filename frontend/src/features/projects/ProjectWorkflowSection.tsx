import { Badge } from '../../components/ui/Badge';
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
import type { Board, Workflow } from '../../lib/api/types';

import { ProjectWorkflowEditor } from './ProjectWorkflowEditor';
import { formatWorkflowStatusCategory, resolveWorkflowStatusName } from './workflowDisplay';

function WorkflowReadOnlyTables({
  data,
  project,
}: {
  data: Workflow;
  project?: { key: string; name: string };
}) {
  const statusName = new Map(data.statuses.map((s) => [s.id, s.name]));
  const statusCategory = new Map(data.statuses.map((s) => [s.id, s.category]));
  const orderedStatuses = [...data.statuses].sort((a, b) => a.position - b.position);
  const transitions = data.transitions;

  return (
    <Card className="space-y-5 p-5 sm:p-6" aria-labelledby="workflow-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="workflow-title" className="text-lg font-semibold text-fg">
              {data.name}
            </h2>
            <Badge tone="neutral">View only</Badge>
          </div>
          {project ? (
            <p className="text-sm text-fg-muted">
              Project <span className="font-mono text-fg">{project.key}</span>
              <span className="text-fg-muted"> · </span>
              {project.name}
              <span className="text-fg-muted"> · </span>
              revision w{data.revision}
            </p>
          ) : null}
          <p className="text-sm text-fg-muted">
            Statuses, allowed transitions, and how statuses map to board columns.
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Statuses</h3>
        {orderedStatuses.length === 0 ? (
          <p className="text-sm text-fg-muted">No statuses defined.</p>
        ) : (
          <DataGrid>
            <DataGridTable aria-label="Workflow statuses">
              <DataGridEqualColumns columnCount={3}>
                <DataGridHead>
                  <DataGridDividedHeadCell>Order</DataGridDividedHeadCell>
                  <DataGridDividedHeadCell>Name</DataGridDividedHeadCell>
                  <DataGridDividedHeadCell>Category</DataGridDividedHeadCell>
                </DataGridHead>
                <DataGridBody>
                  {orderedStatuses.map((s) => (
                    <DataGridRow key={s.id}>
                      <DataGridDividedCell>{s.position}</DataGridDividedCell>
                      <DataGridDividedCell>
                        <span className="inline-flex flex-wrap items-center gap-2">
                          <StatusLozenge name={s.name} category={s.category} />
                          {data.initial_status_id === s.id ? (
                            <Badge tone="neutral">Initial</Badge>
                          ) : null}
                        </span>
                      </DataGridDividedCell>
                      <DataGridDividedCell>
                        {formatWorkflowStatusCategory(s.category)}
                      </DataGridDividedCell>
                    </DataGridRow>
                  ))}
                </DataGridBody>
              </DataGridEqualColumns>
            </DataGridTable>
          </DataGrid>
        )}
      </div>

      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Transitions</h3>
        {transitions.length === 0 ? (
          <p className="text-sm text-fg-muted">No transitions defined.</p>
        ) : (
          <DataGrid>
            <DataGridTable aria-label="Workflow transitions">
              <DataGridEqualColumns columnCount={3}>
                <DataGridHead>
                  <DataGridDividedHeadCell>From</DataGridDividedHeadCell>
                  <DataGridDividedHeadCell>To</DataGridDividedHeadCell>
                  <DataGridDividedHeadCell>Name</DataGridDividedHeadCell>
                </DataGridHead>
                <DataGridBody>
                  {transitions.map((t) => (
                    <DataGridRow key={t.id}>
                      <DataGridDividedCell>
                        {resolveWorkflowStatusName(t.from_status_id, statusName, {
                          nullLabel: 'Any status',
                        })}
                      </DataGridDividedCell>
                      <DataGridDividedCell>
                        {resolveWorkflowStatusName(t.to_status_id, statusName)}
                      </DataGridDividedCell>
                      <DataGridDividedCell>{t.name}</DataGridDividedCell>
                    </DataGridRow>
                  ))}
                </DataGridBody>
              </DataGridEqualColumns>
            </DataGridTable>
          </DataGrid>
        )}
      </div>

      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
          Board columns
        </h3>
        {data.columns.length === 0 ? (
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
                  {data.columns.map((column) => (
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
                              : resolveWorkflowStatusName(id, statusName);
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

export function ProjectWorkflowSection({
  workflow,
  board,
  project,
  canEdit,
  archived,
  org,
  onRetry,
}: {
  workflow: {
    isPending: boolean;
    isError: boolean;
    error: unknown;
    data: Workflow | undefined;
    refetch: () => Promise<unknown>;
  };
  board?: {
    isPending: boolean;
    isError: boolean;
    data: Board | undefined;
    refetch: () => Promise<unknown>;
  };
  project?: { key: string; name: string };
  canEdit: boolean;
  archived: boolean;
  org: string;
  onRetry?: () => void;
}) {
  if (workflow.isPending || (canEdit && board?.isPending)) {
    return (
      <Card className="space-y-4 p-5 sm:p-6">
        <Skeleton className="h-6 w-32" aria-hidden />
        <Skeleton className="h-8 w-full max-w-md" aria-hidden />
        <Skeleton className="h-24 w-full" aria-hidden />
      </Card>
    );
  }
  if (workflow.isError || (canEdit && board?.isError)) {
    return (
      <ErrorState error={workflow.error ?? board?.isError} {...(onRetry ? { onRetry } : {})} />
    );
  }

  const data = workflow.data;
  if (!data) return null;

  if (canEdit && !archived && board?.data && project) {
    return (
      <ProjectWorkflowEditor
        org={org}
        projectKey={project.key}
        projectName={project.name}
        workflow={data}
        board={board.data}
        archived={archived}
      />
    );
  }

  return <WorkflowReadOnlyTables data={data} {...(project ? { project } : {})} />;
}
