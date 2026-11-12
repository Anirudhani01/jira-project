import { Link } from 'react-router';

import { Avatar } from '../../../components/ui/Avatar';
import type { ProjectListItem } from '../../../lib/api/types';

import type { ProjectCardStats } from './hooks/useProjectCardStats';
import {
  boardTypeLabel,
  memberCountLabel,
  ProjectActionsMenu,
  roleLabel,
} from './ProjectDashboardCard';

const HEAD = 'px-5 py-2.5 text-xs font-medium text-[var(--org-dash-muted)]';

/** Issues done out of the issues counted for the project (see ProjectListItem). */
function ProgressCell({ project }: { project: ProjectListItem }) {
  const { done_count: done, issue_count: total } = project;
  if (total === 0) {
    return <span className="text-sm text-[var(--org-dash-muted)]">No issues</span>;
  }
  return (
    <div className="flex items-center gap-3">
      <div
        role="progressbar"
        aria-label={`Issues done in ${project.name}`}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        className="h-1.5 min-w-16 flex-1 rounded-full bg-surface-2"
      >
        <div
          className="h-1.5 rounded-full bg-[var(--org-dash-accent)]"
          style={{ width: `${Math.round((done / total) * 100)}%` }}
        />
      </div>
      <span className="text-sm tabular-nums text-[var(--org-dash-muted)]">
        {done} / {total}
      </span>
    </div>
  );
}

function ProjectRow({
  org,
  project,
  stats,
  statsPending,
}: {
  org: string;
  project: ProjectListItem;
  stats: ProjectCardStats | undefined;
  statsPending: boolean;
}) {
  const board = boardTypeLabel(project.board_type);
  const members = stats ? memberCountLabel(stats.memberCount) : statsPending ? '…' : null;

  return (
    <tr className="border-b border-[var(--org-dash-border)] last:border-0">
      <td className="px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={project.name} size="md" className="shrink-0 rounded-md" />
          <div className="min-w-0">
            <Link
              to={`/o/${org}/p/${project.key}/board`}
              aria-label={`${project.key} — ${project.name}`}
              className="block truncate font-medium text-[var(--org-dash-text)] no-underline hover:text-[var(--org-dash-accent)] hover:underline"
            >
              {project.name}
            </Link>
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--org-dash-muted)]">
              <span className="font-mono">{project.key}</span>
              {members ? <span>· {members}</span> : null}
              {project.my_role && project.my_role !== 'admin' ? (
                <span className="rounded bg-surface-2 px-1.5 py-0.5 font-medium capitalize">
                  {roleLabel(project.my_role)}
                </span>
              ) : null}
              {project.archived ? (
                <span className="rounded bg-warning-soft px-1.5 py-0.5 font-medium text-warning">
                  Archived
                </span>
              ) : null}
            </p>
          </div>
        </div>
      </td>
      <td className="px-5 py-4 text-sm text-[var(--org-dash-text)]">
        {project.active_sprint ? `${board} · ${project.active_sprint}` : board}
      </td>
      <td className="min-w-48 px-5 py-4">
        <ProgressCell project={project} />
      </td>
      <td className="w-12 px-3 py-4 text-right">
        <ProjectActionsMenu org={org} project={project} />
      </td>
    </tr>
  );
}

/** Default project view: one row per project with board type and progress. */
export function ProjectDashboardTable({
  org,
  projects,
  stats,
  statsPending,
}: {
  org: string;
  projects: ProjectListItem[];
  stats: Map<string, ProjectCardStats> | undefined;
  statsPending: boolean;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-[var(--org-dash-border)] bg-[var(--org-dash-surface)]">
      <table className="w-full min-w-[34rem] border-collapse text-left">
        <caption className="sr-only">Projects</caption>
        <thead>
          <tr className="border-b border-[var(--org-dash-border)] bg-surface-hover">
            <th scope="col" className={HEAD}>
              Project
            </th>
            <th scope="col" className={HEAD}>
              Board
            </th>
            <th scope="col" className={HEAD}>
              Issues done
            </th>
            <th scope="col" className="w-12 px-3 py-2.5">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {projects.map((project) => (
            <ProjectRow
              key={project.key}
              org={org}
              project={project}
              stats={stats?.get(project.key)}
              statsPending={statsPending}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
