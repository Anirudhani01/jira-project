import { LayoutGrid, Plus } from 'lucide-react';
import { Link } from 'react-router';

import { Avatar } from '../../components/ui/Avatar';
import { Badge } from '../../components/ui/Badge';
import { Card, EmptyState } from '../../components/ui/Card';
import { ErrorState, ProjectGridSkeleton } from '../../components/ui/States';
import { cn } from '../../lib/cn';
import type { ProjectSummary } from '../../lib/api/types';

import { useProjects } from './api';
import { ProjectTemplatePicker } from './ProjectTemplatePicker';

function boardTypeLabel(type: ProjectSummary['board_type']) {
  return type === 'scrum' ? 'Scrum' : 'Kanban';
}

function ProjectCard({ org, project }: { org: string; project: ProjectSummary }) {
  const label = `${project.key} — ${project.name}`;
  return (
    <Link
      to={`/o/${org}/p/${project.key}/board`}
      className="group block h-full rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      aria-label={label}
    >
      <Card className="flex h-full flex-col gap-3 p-4 transition-colors group-hover:border-line-strong group-hover:bg-surface-hover">
        <div className="flex items-start gap-3">
          <Avatar name={project.name} size="md" className="shrink-0 rounded-md" />
          <div className="min-w-0 flex-1">
            <p className="font-mono text-xs text-fg-muted">{project.key}</p>
            <p className="truncate font-medium text-fg">{project.name}</p>
          </div>
        </div>
        <div className="mt-auto flex flex-wrap gap-2">
          <Badge tone="neutral">{boardTypeLabel(project.board_type)}</Badge>
          {project.archived ? <Badge tone="warning">Archived</Badge> : null}
          {project.my_role ? (
            <Badge tone="neutral" className="capitalize">
              {project.my_role}
            </Badge>
          ) : null}
        </div>
      </Card>
    </Link>
  );
}

function CreateProjectCard({ org }: { org: string }) {
  return (
    <Link
      to={`/o/${org}/projects/new`}
      className="group block h-full rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      aria-label="Create project"
    >
      <Card
        className={cn(
          'flex h-full min-h-[8.5rem] flex-col items-center justify-center gap-2 border-dashed p-4',
          'text-fg-muted transition-colors group-hover:border-accent group-hover:text-accent',
        )}
      >
        <Plus className="size-8" aria-hidden="true" />
        <span className="text-sm font-medium">Create project</span>
      </Card>
    </Link>
  );
}

function ProjectsEmptyState({ org, canCreate }: { org: string; canCreate: boolean }) {
  return (
    <div className="space-y-4">
      <EmptyState
        icon={<LayoutGrid className="size-10" aria-hidden="true" />}
        title="No projects yet"
        description={
          canCreate
            ? 'Start with a Kanban board for continuous flow, or Scrum for sprints and backlogs.'
            : 'Projects you can access will appear here.'
        }
      />
      {canCreate ? (
        <p className="text-center">
          <Link
            to={`/o/${org}/projects/new`}
            className="text-sm font-medium text-accent underline-offset-2 hover:underline"
          >
            Create project
          </Link>
        </p>
      ) : null}
    </div>
  );
}

export function ProjectList({ org, canCreate }: { org: string; canCreate: boolean }) {
  const projects = useProjects(org);
  if (projects.isPending) return <ProjectGridSkeleton />;
  if (projects.isError) {
    return <ErrorState error={projects.error} onRetry={() => void projects.refetch()} />;
  }

  const items = projects.data.filter((p) => !p.archived);

  if (!items.length && !canCreate) {
    return <ProjectsEmptyState org={org} canCreate={false} />;
  }

  if (!items.length && canCreate) {
    return (
      <div className="space-y-6">
        <ProjectsEmptyState org={org} canCreate={true} />
        <ProjectTemplatePicker org={org} />
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((p) => (
        <ProjectCard key={p.key} org={org} project={p} />
      ))}
      {canCreate ? <CreateProjectCard org={org} /> : null}
    </div>
  );
}
