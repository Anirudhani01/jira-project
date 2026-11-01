import { ChevronDown, ChevronRight } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';

import { Badge } from '../../../components/ui/Badge';
import { EmptyState, Skeleton } from '../../../components/ui/Card';
import { Button } from '../../../components/ui/Button';
import { ErrorState } from '../../../components/ui/States';
import type { ProjectSummary } from '../../../lib/api/types';
import { useProjects, useWorkflow } from '../../projects/api';
import { ProjectWorkflowSection } from '../../projects/ProjectWorkflowSection';

import { AdminOrgManagePageFrame } from './AdminOrgManagePageFrame';

const HUB_DESCRIPTION =
  'Each project has its own workflow instance, cloned from the default workflow when the project was created. These are not shared organization-wide templates. Expand a row to inspect statuses, transitions, and board column mappings. Board column editing stays on each project’s Columns tab. Expanding projects loads workflow data with individual GET requests (no bulk API in this release).';

function formatBoardType(boardType: string): string {
  return boardType === 'scrum' ? 'Scrum' : 'Kanban';
}

function projectPaths(org: string, key: string) {
  const base = `/o/${org}/p/${key}`;
  return { board: `${base}/board`, settings: base };
}

function LazyProjectWorkflow({ org, project }: { org: string; project: ProjectSummary }) {
  const workflow = useWorkflow(org, project.key, { enabled: true });
  return (
    <div className="border-t border-[var(--admin-border)] bg-[var(--admin-bg)] px-4 py-4 sm:px-5">
      <ProjectWorkflowSection
        org={org}
        workflow={workflow}
        project={{ key: project.key, name: project.name }}
        canEdit={false}
        archived={project.archived}
        onRetry={() => void workflow.refetch()}
      />
    </div>
  );
}

function ProjectWorkflowRow({
  org,
  project,
  expanded,
  onToggle,
}: {
  org: string;
  project: ProjectSummary;
  expanded: boolean;
  onToggle: () => void;
}) {
  const paths = projectPaths(org, project.key);
  const panelId = `admin-workflow-panel-${project.key}`;

  return (
    <li className="admin-card min-w-0 overflow-hidden rounded-xl border shadow-sm">
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="flex min-w-0 flex-1 items-start gap-2">
          <button
            type="button"
            className="mt-0.5 shrink-0 rounded-md p-1 text-[var(--admin-muted)] hover:bg-[var(--admin-accent-soft)] hover:text-[var(--admin-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--admin-accent)]"
            aria-expanded={expanded}
            aria-controls={panelId}
            onClick={onToggle}
          >
            <span className="sr-only">
              {expanded ? 'Collapse' : 'Expand'} workflow details for {project.key}
            </span>
            {expanded ? (
              <ChevronDown className="size-5" aria-hidden />
            ) : (
              <ChevronRight className="size-5" aria-hidden />
            )}
          </button>
          <div className="min-w-0 space-y-1">
            <p className="truncate text-base font-semibold text-[var(--admin-text)]">
              <span className="font-mono text-sm">{project.key}</span>
              <span className="text-[var(--admin-muted)]"> · </span>
              {project.name}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {project.archived ? (
                <Badge tone="warning">Archived</Badge>
              ) : (
                <Badge tone="neutral">Active</Badge>
              )}
              <Badge tone="neutral">{formatBoardType(project.board_type)}</Badge>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 sm:shrink-0">
          <Button asChild variant="secondary" size="sm">
            <Link to={paths.board}>Board</Link>
          </Button>
          <Button asChild variant="secondary" size="sm">
            <Link to={paths.settings}>Project settings</Link>
          </Button>
        </div>
      </div>
      {expanded ? (
        <div id={panelId}>
          <LazyProjectWorkflow org={org} project={project} />
        </div>
      ) : null}
    </li>
  );
}

/** Lists organization projects and lazy-loads read-only workflow details on expand. */
function AuthorizedAdminWorkflowHub() {
  const { org: slug = '' } = useParams();
  const activeProjects = useProjects(slug);
  const archivedProjects = useProjects(slug, { archived: true });
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(() => new Set());

  const projects = useMemo(() => {
    const items = [...(activeProjects.data ?? []), ...(archivedProjects.data ?? [])];
    return items.sort((a, b) => a.key.localeCompare(b.key));
  }, [activeProjects.data, archivedProjects.data]);

  const listReady = activeProjects.isFetched && archivedProjects.isFetched;
  const listPending = !listReady;
  const listFailed =
    listReady && activeProjects.isError && archivedProjects.isError && projects.length === 0;
  const listPartialError =
    listReady && (activeProjects.isError || archivedProjects.isError) && projects.length > 0;

  const toggle = (key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  if (listPending) {
    return (
      <div className="space-y-3" role="status" aria-label="Loading projects">
        <Skeleton className="h-24 w-full" aria-hidden />
        <Skeleton className="h-24 w-full" aria-hidden />
      </div>
    );
  }
  if (listFailed) {
    return (
      <ErrorState
        error={activeProjects.error}
        onRetry={() => {
          void activeProjects.refetch();
          void archivedProjects.refetch();
        }}
      />
    );
  }

  return (
    <>
      {listPartialError ? (
        <ErrorState
          error={activeProjects.error ?? archivedProjects.error}
          onRetry={() => {
            if (activeProjects.isError) void activeProjects.refetch();
            if (archivedProjects.isError) void archivedProjects.refetch();
          }}
        />
      ) : null}
      {projects.length === 0 ? (
        <EmptyState
          title="No organization projects"
          description="No projects exist in this organization yet."
        />
      ) : (
        <ul className="space-y-3">
          {projects.map((project) => (
            <ProjectWorkflowRow
              key={project.key}
              org={slug}
              project={project}
              expanded={expandedKeys.has(project.key)}
              onToggle={() => {
                toggle(project.key);
              }}
            />
          ))}
        </ul>
      )}
    </>
  );
}

export function AdminWorkflowHubPage() {
  return (
    <AdminOrgManagePageFrame
      titleId="admin-workflow-title"
      title="Workflows"
      description={HUB_DESCRIPTION}
    >
      <AuthorizedAdminWorkflowHub />
    </AdminOrgManagePageFrame>
  );
}
