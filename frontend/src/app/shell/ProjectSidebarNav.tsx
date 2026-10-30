import {
  KanbanSquare,
  LayoutList,
  PanelLeftClose,
  PanelLeftOpen,
  Rows3,
  Settings,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { NavLink } from 'react-router';

import { Avatar } from '../../components/ui/Avatar';
import { IconButton } from '../../components/ui/Button';
import { useProject } from '../../features/projects/api';

import { cn } from '../../lib/cn';

import { useBoardShell } from './useBoardShell';
import { writeSidebarCollapsed } from './storage';
import { useProjectContext } from './useProjectContext';

function navClass({ isActive }: { isActive: boolean }, boardShell: boolean) {
  return cn(
    'flex items-center gap-2 rounded-md py-1.5 text-sm no-underline outline-none',
    boardShell ? 'pl-2.5 pr-2' : 'px-2',
    boardShell
      ? 'hover:bg-[var(--board-accent-soft)] focus-visible:ring-2 focus-visible:ring-[var(--board-accent)]'
      : 'hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent',
    boardShell && isActive && 'board-sidebar-nav-active',
    !boardShell && isActive && 'bg-surface-2 font-medium text-fg',
    !boardShell && !isActive && 'text-fg-muted',
    boardShell && !isActive && 'text-[var(--board-muted)]',
  );
}

export function ProjectSidebarNav({
  collapsed,
  onCollapsedChange,
  onNavigate,
}: {
  collapsed: boolean;
  onCollapsedChange: (value: boolean) => void;
  onNavigate?: () => void;
}) {
  const ctx = useProjectContext();
  const org = ctx?.org ?? '';
  const projectKey = ctx?.projectKey ?? '';
  const project = useProject(org, projectKey);
  const boardShell = useBoardShell();
  if (!ctx?.projectKey) return null;
  const base = `/o/${org}/p/${projectKey}`;
  const showBacklog = project.data?.board_type === 'scrum';

  const link = (to: string, label: string, icon: ReactNode, end?: boolean) => (
    <NavLink
      to={to}
      end={end ?? to === base}
      className={({ isActive }) => navClass({ isActive }, boardShell)}
      onClick={onNavigate}
    >
      {icon}
      {collapsed ? <span className="sr-only">{label}</span> : <span>{label}</span>}
    </NavLink>
  );

  return (
    <div className="flex h-full flex-col gap-3 p-2">
      <div className="flex items-center gap-2 px-1">
        {project.data ? (
          <>
            <Avatar name={project.data.name} size="sm" />
            {!collapsed ? (
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-xs text-fg-muted">{project.data.key}</p>
                <p className="truncate text-sm font-semibold">{project.data.name}</p>
              </div>
            ) : (
              <span className="sr-only">
                {project.data.key} {project.data.name}
              </span>
            )}
          </>
        ) : (
          <span className="font-mono text-sm">{projectKey}</span>
        )}
        <IconButton
          label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          size="sm"
          className="hidden lg:inline-flex"
          onClick={() => {
            const next = !collapsed;
            writeSidebarCollapsed(next);
            onCollapsedChange(next);
          }}
        >
          {collapsed ? (
            <PanelLeftOpen className="size-4" aria-hidden="true" />
          ) : (
            <PanelLeftClose className="size-4" aria-hidden="true" />
          )}
        </IconButton>
      </div>
      <nav aria-label="Project" className="flex flex-1 flex-col gap-0.5">
        {link(
          `${base}/board`,
          'Board',
          <KanbanSquare className="size-4 shrink-0" aria-hidden />,
          true,
        )}
        {showBacklog
          ? link(`${base}/backlog`, 'Backlog', <Rows3 className="size-4 shrink-0" aria-hidden />)
          : null}
        {link(`${base}/issues`, 'Issues', <LayoutList className="size-4 shrink-0" aria-hidden />)}
        {link(base, 'Settings', <Settings className="size-4 shrink-0" aria-hidden />)}
      </nav>
    </div>
  );
}
