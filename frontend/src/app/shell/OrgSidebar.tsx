import { BarChart3, Home, KanbanSquare, LayoutGrid, LayoutList, Settings } from 'lucide-react';
import type { ReactNode } from 'react';
import { NavLink } from 'react-router';

import { Avatar } from '../../components/ui/Avatar';
import { cn } from '../../lib/cn';
import { useSession } from '../../features/auth/api';
import { useProjects } from '../../features/projects/api';

import { useShell } from './ShellContext';
import { useOrgDashboardHome, useOrgSlug, useShowOrgSidebar } from './useOrgShell';

function orgNavClass(isActive: boolean, dashboardHome: boolean) {
  return cn(
    'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm no-underline outline-none transition-colors',
    'hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent',
    dashboardHome &&
      'hover:bg-[var(--org-dash-accent-soft)] focus-visible:ring-[var(--org-dash-accent)]',
    isActive && !dashboardHome && 'bg-surface-2 font-medium text-fg',
    isActive &&
      dashboardHome &&
      'bg-[var(--org-dash-accent-soft)] font-medium org-dash-on-accent-soft',
    !isActive && 'text-fg-muted',
    !isActive && dashboardHome && 'text-[var(--org-dash-muted)]',
  );
}

function OrgSidebarNav({
  onNavigate,
  dashboardHome,
}: {
  onNavigate?: () => void;
  dashboardHome: boolean;
}) {
  const org = useOrgSlug() ?? '';
  const projects = useProjects(org);
  const recent = (projects.data ?? []).filter((p) => !p.archived).slice(0, 5);
  const firstProject = recent[0];

  const link = (
    to: string,
    label: string,
    icon: ReactNode,
    activeWhen?: (active: boolean) => boolean,
  ) => (
    <NavLink
      to={to}
      end
      className={({ isActive: active }) =>
        orgNavClass(activeWhen ? activeWhen(active) : active, dashboardHome)
      }
      onClick={onNavigate}
    >
      {icon}
      <span>{label}</span>
    </NavLink>
  );

  const unavailable = (label: string, reason: string, icon: ReactNode) => (
    <span
      title={reason}
      className={cn(
        'flex cursor-not-allowed items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm',
        dashboardHome ? 'text-[var(--org-dash-muted)]' : 'text-fg-subtle opacity-60',
      )}
      aria-disabled="true"
    >
      {icon}
      <span>{label}</span>
    </span>
  );

  const issuesTo = firstProject ? `/o/${org}/p/${firstProject.key}/issues` : null;
  const boardTo = firstProject ? `/o/${org}/p/${firstProject.key}/board` : null;

  return (
    <div className="flex h-full flex-col gap-4 p-3">
      <nav aria-label="Organization" className="flex flex-col gap-0.5">
        {link(`/o/${org}`, 'Home', <Home className="size-4 shrink-0" aria-hidden />)}
        {link(
          `/o/${org}`,
          'Projects',
          <LayoutGrid className="size-4 shrink-0" aria-hidden />,
          () => false,
        )}
        {issuesTo
          ? link(issuesTo, 'Issues', <LayoutList className="size-4 shrink-0" aria-hidden />)
          : unavailable(
              'Issues',
              'Create a project to browse issues',
              <LayoutList className="size-4 shrink-0" aria-hidden />,
            )}
        {boardTo
          ? link(boardTo, 'Boards', <KanbanSquare className="size-4 shrink-0" aria-hidden />)
          : unavailable(
              'Boards',
              'Create a project to open a board',
              <KanbanSquare className="size-4 shrink-0" aria-hidden />,
            )}
        {unavailable(
          'Reports',
          'Reports are not available yet',
          <BarChart3 className="size-4 shrink-0" aria-hidden />,
        )}
        {link(
          `/o/${org}/admin`,
          'Administration',
          <Settings className="size-4 shrink-0" aria-hidden />,
        )}
      </nav>
      <div
        className={cn(
          'mt-auto border-t border-line pt-4',
          dashboardHome && 'border-[var(--org-dash-border)]',
        )}
      >
        <p
          className={cn(
            'mb-2 px-2.5 text-xs font-semibold uppercase tracking-wide text-fg-subtle',
            dashboardHome && 'text-[var(--org-dash-muted)]',
          )}
        >
          Recent projects
        </p>
        {projects.isPending ? (
          <p className="px-2.5 text-xs text-fg-subtle">Loading…</p>
        ) : recent.length === 0 ? (
          <p className="px-2.5 text-xs text-fg-subtle">No projects yet</p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {recent.map((project) => (
              <li key={project.key}>
                <NavLink
                  to={`/o/${org}/p/${project.key}/board`}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm no-underline',
                      isActive
                        ? 'bg-surface-2 font-medium'
                        : 'text-fg-muted hover:bg-surface-hover',
                      dashboardHome &&
                        (isActive
                          ? 'bg-[var(--org-dash-accent-soft)] text-[var(--org-dash-accent)]'
                          : 'hover:bg-[var(--org-dash-accent-soft)]/60'),
                    )
                  }
                  onClick={onNavigate}
                >
                  <Avatar name={project.name} size="xs" className="rounded-md" />
                  <span className="truncate">{project.name}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function OrgSidebar() {
  const session = useSession();
  const show = useShowOrgSidebar();
  const dashboardHome = useOrgDashboardHome();
  if (!show || !session.data) return null;

  return (
    <aside
      className={cn(
        'org-dash-sidebar hidden w-[232px] shrink-0 border-r border-line bg-surface lg:block',
        dashboardHome &&
          'org-dash-sidebar border-[var(--org-dash-border)] bg-[var(--org-dash-surface)]',
      )}
    >
      <OrgSidebarNav dashboardHome={dashboardHome} />
    </aside>
  );
}

export function MobileOrgDrawer() {
  const session = useSession();
  const { mobileNavOpen, setMobileNavOpen } = useShell();
  const showOrgSidebar = useShowOrgSidebar();
  const dashboardHome = useOrgDashboardHome();

  if (!showOrgSidebar || !session.data || !mobileNavOpen) return null;

  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      <button
        type="button"
        aria-label="Close navigation"
        className="absolute inset-0 bg-black/40"
        onClick={() => {
          setMobileNavOpen(false);
        }}
      />
      <aside className="relative h-full w-[min(100%,16rem)] border-r border-line bg-surface shadow-lg">
        <OrgSidebarNav
          dashboardHome={dashboardHome}
          onNavigate={() => {
            setMobileNavOpen(false);
          }}
        />
      </aside>
    </div>
  );
}
