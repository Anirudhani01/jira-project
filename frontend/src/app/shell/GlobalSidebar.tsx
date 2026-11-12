import {
  BarChart3,
  Home,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  SlidersHorizontal,
  Star,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink } from 'react-router';

import { Avatar } from '../../components/ui/Avatar';
import { Badge } from '../../components/ui/Badge';
import { Button, IconButton } from '../../components/ui/Button';
import { DialogContent, Dialog } from '../../components/ui/Overlay';
import { useSession } from '../../features/auth/api';
import { useOrg } from '../../features/orgs/api';
import { useProjects } from '../../features/projects/api';
import { cn } from '../../lib/cn';

import {
  SIDEBAR_ITEMS,
  useHiddenSidebarItems,
  useStarred,
  useTrackRecents,
  type SidebarItem,
} from './navPrefs';
import { useShell } from './ShellContext';
import { readSidebarCollapsed, writeSidebarCollapsed } from './storage';
import { useOrgSlug, useShowGlobalSidebar } from './useOrgShell';

const LABELS: Record<SidebarItem, string> = {
  'for-you': 'For you',
  starred: 'Starred',
  projects: 'Projects',
  reports: 'Reports',
};

function itemClass(isActive: boolean) {
  return cn(
    'flex items-center gap-3 rounded-md px-3 py-2 text-sm no-underline outline-none',
    'hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent',
    isActive ? 'bg-accent-soft font-medium text-fg' : 'text-fg-muted',
  );
}

function SectionTitle({
  children,
  collapsed,
  action,
}: {
  children: ReactNode;
  collapsed: boolean;
  action?: ReactNode;
}) {
  if (collapsed) return <hr className="mx-2 my-2 border-line" />;
  return (
    <div className="mb-1 mt-3 flex items-center justify-between pl-3 pr-1">
      <p className="text-xs font-medium text-fg-subtle">{children}</p>
      {action}
    </div>
  );
}

function CustomizeDialog({
  org,
  open,
  onOpenChange,
}: {
  org: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { hidden, toggle } = useHiddenSidebarItems(org);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Customize sidebar"
        description="Choose what appears in your sidebar. Only you see this."
      >
        <ul className="space-y-1">
          {SIDEBAR_ITEMS.filter((item) => item !== 'for-you').map((item) => (
            <li key={item}>
              <label className="flex items-center gap-2 py-1 text-sm">
                <input
                  type="checkbox"
                  checked={!hidden.includes(item)}
                  onChange={() => {
                    toggle(item);
                  }}
                />
                {LABELS[item]}
              </label>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex justify-end">
          <Button
            variant="primary"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function GlobalNav({
  collapsed,
  onNavigate,
  onToggleCollapsed,
  showCollapse,
}: {
  collapsed: boolean;
  onNavigate?: () => void;
  onToggleCollapsed: () => void;
  showCollapse: boolean;
}) {
  const org = useOrgSlug() ?? '';
  const projects = useProjects(org);
  const canCreateProject = useOrg(org).data?.permissions.includes('project.create') ?? false;
  const { hidden } = useHiddenSidebarItems(org);
  const { starred } = useStarred(org);
  const [customizing, setCustomizing] = useState(false);
  const visible = (item: SidebarItem) => !hidden.includes(item);
  const live = (projects.data ?? []).filter((p) => !p.archived);

  const link = (to: string, label: string, icon: ReactNode, end = true) => (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) => itemClass(isActive)}
      onClick={onNavigate}
      title={collapsed ? label : undefined}
    >
      {icon}
      {collapsed ? (
        <span className="sr-only">{label}</span>
      ) : (
        <span className="truncate">{label}</span>
      )}
    </NavLink>
  );

  return (
    <div className="flex h-full flex-col gap-0.5 p-2">
      <nav aria-label="Global" className="flex flex-col gap-0.5">
        {link(`/o/${org}`, 'For you', <Home className="size-4 shrink-0" aria-hidden />)}

        {visible('projects') ? (
          <>
            <SectionTitle
              collapsed={collapsed}
              action={
                canCreateProject ? (
                  <Link
                    to={`/o/${org}/projects/new`}
                    aria-label="Create project"
                    title="Create project"
                    onClick={onNavigate}
                    className="inline-flex size-6 items-center justify-center rounded-md text-fg-muted no-underline outline-none hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    <Plus className="size-4" aria-hidden />
                  </Link>
                ) : null
              }
            >
              Projects
            </SectionTitle>
            {projects.isPending && !collapsed ? (
              <p className="px-3 text-xs text-fg-subtle">Loading…</p>
            ) : null}
            {live.map((project) =>
              link(
                `/o/${org}/p/${project.key}/board`,
                project.name,
                <Avatar name={project.name} size="xs" className="rounded-md" />,
                false,
              ),
            )}
          </>
        ) : null}

        {visible('starred') ? (
          <>
            <SectionTitle collapsed={collapsed}>Starred</SectionTitle>
            {starred.length === 0 && !collapsed ? (
              <p className="px-3 text-xs text-fg-subtle">Star a project to pin it here</p>
            ) : (
              starred.map((project) =>
                link(
                  `/o/${org}/p/${project.key}/board`,
                  project.name,
                  <Star className="size-4 shrink-0 fill-current text-warning" aria-hidden />,
                  false,
                ),
              )
            )}
          </>
        ) : null}

        {visible('reports') ? (
          <>
            <SectionTitle collapsed={collapsed}>Manage</SectionTitle>
            <span
              aria-disabled="true"
              title="Reports are not available yet"
              className="flex cursor-not-allowed items-center gap-3 px-3 py-2 text-sm text-fg-subtle opacity-70"
            >
              <BarChart3 className="size-4 shrink-0" aria-hidden />
              {collapsed ? (
                <span className="sr-only">Reports</span>
              ) : (
                <>
                  <span>Reports</span>
                  <Badge>Soon</Badge>
                </>
              )}
            </span>
          </>
        ) : null}
        {link(
          `/o/${org}/admin`,
          'Administration',
          <SlidersHorizontal className="size-4 shrink-0" aria-hidden />,
          false,
        )}
      </nav>
      <div className="mt-auto flex flex-col gap-0.5 border-t border-line pt-2">
        <Button
          variant="ghost"
          size="sm"
          className={cn('justify-start', collapsed && 'px-2')}
          onClick={() => {
            setCustomizing(true);
          }}
        >
          <SlidersHorizontal className="size-4" aria-hidden="true" />
          {collapsed ? (
            <span className="sr-only">Customize sidebar</span>
          ) : (
            <span>Customize sidebar</span>
          )}
        </Button>
        {showCollapse ? (
          <IconButton
            label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            size="sm"
            className="self-end"
            onClick={onToggleCollapsed}
          >
            {collapsed ? (
              <PanelLeftOpen className="size-4" aria-hidden="true" />
            ) : (
              <PanelLeftClose className="size-4" aria-hidden="true" />
            )}
          </IconButton>
        ) : null}
      </div>
      <CustomizeDialog org={org} open={customizing} onOpenChange={setCustomizing} />
    </div>
  );
}

/** Global left navigation (For you, Projects, Starred, Manage). Collapsible with the
 * button or Ctrl + [ . */
export function GlobalSidebar() {
  const session = useSession();
  const show = useShowGlobalSidebar();
  const org = useOrgSlug();
  const [collapsed, setCollapsed] = useState(() => readSidebarCollapsed());
  useTrackRecents(show && session.data ? org : null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key === '[') {
        event.preventDefault();
        setCollapsed((current) => {
          writeSidebarCollapsed(!current);
          return !current;
        });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  if (!show || !session.data) return null;
  return (
    <aside
      aria-label="Sidebar"
      className={cn(
        'sticky top-[57px] hidden h-[calc(100vh-57px)] shrink-0 self-start overflow-y-auto border-r border-line bg-surface lg:block',
        collapsed ? 'w-14' : 'w-[240px]',
      )}
    >
      <GlobalNav
        collapsed={collapsed}
        showCollapse
        onToggleCollapsed={() => {
          setCollapsed((current) => {
            writeSidebarCollapsed(!current);
            return !current;
          });
        }}
      />
    </aside>
  );
}

export function MobileGlobalDrawer() {
  const session = useSession();
  const show = useShowGlobalSidebar();
  const { mobileNavOpen, setMobileNavOpen } = useShell();
  if (!show || !session.data || !mobileNavOpen) return null;
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
      <aside className="relative h-full w-[min(100%,17rem)] border-r border-line bg-surface shadow-lg">
        <GlobalNav
          collapsed={false}
          showCollapse={false}
          onToggleCollapsed={() => undefined}
          onNavigate={() => {
            setMobileNavOpen(false);
          }}
        />
      </aside>
    </div>
  );
}
