import { MoreHorizontal } from 'lucide-react';
import { Link } from 'react-router';

import { Avatar } from '../../../components/ui/Avatar';
import { IconButton } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../../components/ui/Overlay';
import { cn } from '../../../lib/cn';
import type { ProjectSummary } from '../../../lib/api/types';
import { useSetArchived } from '../../projects/api';

import type { ProjectCardStats } from './hooks/useProjectCardStats';

function boardTypeLabel(type: ProjectSummary['board_type']) {
  return type === 'scrum' ? 'Scrum' : 'Kanban';
}

function roleLabel(role: string | null | undefined) {
  if (!role) return null;
  return role.charAt(0).toUpperCase() + role.slice(1);
}

function ProjectStatsLine({
  stats,
  pending,
}: {
  stats: ProjectCardStats | undefined;
  pending: boolean;
}) {
  if (pending && !stats) {
    return (
      <p className="text-xs text-[var(--org-dash-muted)]" aria-busy="true">
        Loading stats…
      </p>
    );
  }
  if (!stats) return null;
  const issues = stats.issueCount === 1 ? '1 issue' : `${stats.issueCount} issues`;
  const members = stats.memberCount === 1 ? '1 member' : `${stats.memberCount} members`;
  return (
    <p className="text-xs tabular-nums text-[var(--org-dash-muted)]">
      {issues} · {members}
    </p>
  );
}

export function ProjectDashboardCard({
  org,
  project,
  description,
  stats,
  statsPending = false,
  view,
}: {
  org: string;
  project: ProjectSummary;
  description?: string | null;
  stats?: ProjectCardStats;
  statsPending?: boolean;
  view: 'grid' | 'list';
}) {
  const boardHref = `/o/${org}/p/${project.key}/board`;
  const settingsHref = `/o/${org}/p/${project.key}`;
  const label = `${project.key} — ${project.name}`;
  const archive = useSetArchived(org, project.key);
  const canArchive = project.my_role === 'admin';

  const meta = (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="org-dash-on-accent-soft rounded-md bg-[var(--org-dash-accent-soft)] px-2 py-0.5 font-medium">
        {boardTypeLabel(project.board_type)}
      </span>
      {project.my_role ? (
        <span className="rounded-md bg-surface-2 px-2 py-0.5 font-medium text-fg-muted capitalize">
          {roleLabel(project.my_role)}
        </span>
      ) : null}
      {project.archived ? (
        <span className="rounded-md bg-warning-soft px-2 py-0.5 font-medium text-warning">Archived</span>
      ) : (
        <span className="inline-flex items-center gap-1 text-[var(--org-dash-muted)]">
          <span className="size-1.5 rounded-full bg-success" aria-hidden />
          Active
        </span>
      )}
    </div>
  );

  const menu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton label={`Actions for ${project.name}`} size="sm" className="shrink-0">
          <MoreHorizontal className="size-4" aria-hidden />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <Link to={boardHref}>Open board</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to={settingsHref}>Project settings</Link>
        </DropdownMenuItem>
        {canArchive ? (
          <DropdownMenuItem
            disabled={archive.isPending}
            onSelect={() => {
              archive.mutate(!project.archived);
            }}
          >
            {project.archived ? 'Unarchive project' : 'Archive project'}
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  if (view === 'list') {
    return (
      <Card className="org-dash-card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <Link
          to={boardHref}
          className="flex min-w-0 flex-1 items-center gap-3 no-underline outline-none focus-visible:ring-2 focus-visible:ring-[var(--org-dash-accent)]"
          aria-label={label}
        >
          <Avatar name={project.name} size="md" className="shrink-0 rounded-lg" />
          <div className="min-w-0">
            <p className="truncate font-semibold text-[var(--org-dash-text)]">{project.name}</p>
            <p className="font-mono text-xs text-[var(--org-dash-muted)]">{project.key}</p>
            {description ? (
              <p className="mt-1 line-clamp-1 text-sm text-[var(--org-dash-muted)]">{description}</p>
            ) : null}
            <ProjectStatsLine stats={stats} pending={statsPending} />
          </div>
        </Link>
        <div className="flex items-center gap-2 sm:justify-end">
          {meta}
          {menu}
        </div>
      </Card>
    );
  }

  return (
    <Card className="org-dash-card relative flex h-full flex-col gap-3 p-4">
      <div className="absolute right-2 top-2">{menu}</div>
      <Link
        to={boardHref}
        className="group flex flex-1 flex-col gap-3 no-underline outline-none focus-visible:ring-2 focus-visible:ring-[var(--org-dash-accent)]"
        aria-label={label}
      >
        <div className="flex items-start gap-3 pr-8">
          <Avatar name={project.name} size="md" className="shrink-0 rounded-lg" />
          <div className="min-w-0">
            <p className="truncate font-semibold text-[var(--org-dash-text)] group-hover:text-[var(--org-dash-accent)]">
              {project.name}
            </p>
            <p className="font-mono text-xs text-[var(--org-dash-muted)]">{project.key}</p>
          </div>
        </div>
        {description ? (
          <p className="line-clamp-2 min-h-[2.5rem] text-sm leading-relaxed text-[var(--org-dash-muted)]">
            {description}
          </p>
        ) : (
          <p className="min-h-[2.5rem] text-sm text-[var(--org-dash-muted)]">&nbsp;</p>
        )}
        <ProjectStatsLine stats={stats} pending={statsPending} />
        <div className="mt-auto">{meta}</div>
      </Link>
    </Card>
  );
}

export function CreateProjectDashboardCard({ org }: { org: string }) {
  return (
    <Link
      to={`/o/${org}/projects/new`}
      className={cn(
        'group flex h-full min-h-[11rem] flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 text-center no-underline',
        'border-[var(--org-dash-border)] bg-[var(--org-dash-surface)] transition-colors',
        'hover:border-[var(--org-dash-accent)] hover:bg-[var(--org-dash-accent-soft)]/40',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--org-dash-accent)]',
      )}
      aria-label="Create new project"
    >
      <span className="org-dash-on-accent-soft flex size-12 items-center justify-center rounded-full bg-[var(--org-dash-accent-soft)]">
        <span className="text-2xl font-light leading-none" aria-hidden>
          +
        </span>
      </span>
      <p className="mt-3 text-sm font-semibold text-[var(--org-dash-text)]">Create new project</p>
      <p className="mt-1 max-w-[14rem] text-xs leading-relaxed text-[var(--org-dash-muted)]">
        Start a new project to plan, track and manage your work.
      </p>
    </Link>
  );
}
