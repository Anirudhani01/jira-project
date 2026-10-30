import { ChevronDown, CircleHelp, LayoutGrid, Menu, Monitor, Plus } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router';

import { Button, IconButton } from '../../components/ui/Button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../components/ui/Overlay';
import { useSession } from '../../features/auth/api';
import { OrgNotificationBell } from '../../features/notifications/NotificationBell';

import { GlobalSearchBar } from './GlobalSearchBar';
import { OrgMenu } from './OrgMenu';
import { ProfileMenu } from './ProfileMenu';
import { ProjectSwitcher } from './ProjectSwitcher';
import { useShell } from './ShellContext';
import { ThemeToggle } from './ThemeToggle';
import { useProjectContext, useShowProjectSidebar } from './useProjectContext';
import { useShowOrgSidebar } from './useOrgShell';

function GuestNav() {
  const { pathname } = useLocation();
  return (
    <div className="flex items-center gap-4 text-sm">
      {pathname === '/login' ? (
        <span className="font-medium text-accent">Sign in</span>
      ) : (
        <Link to="/login" className="font-medium text-fg-muted no-underline hover:text-accent">
          Sign in
        </Link>
      )}
      <Button variant="primary" size="sm" className="rounded-lg px-4" asChild>
        <Link to="/signup">Sign up</Link>
      </Button>
    </div>
  );
}

function SignedInActions({ boardShell }: { boardShell: boolean }) {
  const ctx = useProjectContext();
  const navigate = useNavigate();

  const openCreateIssue = () => {
    if (!ctx?.projectKey) return;
    void navigate(`/o/${ctx.org}/p/${ctx.projectKey}/issues`);
  };

  return (
    <div className="flex shrink-0 items-center gap-1">
      {ctx?.projectKey ? (
        boardShell ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="primary"
                size="sm"
                className="board-btn-primary hidden gap-1 rounded-lg px-3 sm:inline-flex"
              >
                <Plus className="size-4" aria-hidden="true" />
                Create
                <ChevronDown className="size-3.5 opacity-80" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onSelect={() => {
                  openCreateIssue();
                }}
              >
                Create issue
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <Button
            variant="primary"
            size="sm"
            className="hidden sm:inline-flex"
            onClick={openCreateIssue}
          >
            <Plus className="size-4" aria-hidden="true" />
            Create
          </Button>
        )
      ) : null}
      {ctx?.org ? (
        boardShell ? (
          <span className="hidden sm:contents">
            <OrgNotificationBell />
          </span>
        ) : (
          <OrgNotificationBell />
        )
      ) : null}
      <IconButton
        label="Help — not available yet"
        size="sm"
        className="hidden sm:inline-flex"
        disabled
        title="Help is not available yet"
      >
        <CircleHelp className="size-4" aria-hidden="true" />
      </IconButton>
      {boardShell ? (
        <IconButton label="Display options" size="sm" className="hidden sm:inline-flex" disabled>
          <Monitor className="size-4" aria-hidden="true" />
        </IconButton>
      ) : (
        <ThemeToggle />
      )}
      <ProfileMenu />
    </div>
  );
}

export function TopBar({
  orgDashboardHome = false,
  boardShell = false,
}: {
  orgDashboardHome?: boolean;
  boardShell?: boolean;
}) {
  const session = useSession();
  const { setMobileNavOpen } = useShell();
  const showProjectSidebar = useShowProjectSidebar();
  const showOrgNav = useShowOrgSidebar();
  const ctx = useProjectContext();
  const signedIn = Boolean(session.data);
  const showGlobalSearch = signedIn && Boolean(ctx?.org) && (!ctx?.projectKey || boardShell);

  return (
    <header
      className={
        orgDashboardHome
          ? 'org-dash-topbar border-b border-[var(--org-dash-border)] bg-[var(--org-dash-surface)]'
          : boardShell
            ? 'board-topbar max-w-full overflow-x-clip border-b'
            : 'border-b border-line bg-surface'
      }
    >
      <nav
        aria-label="Primary"
        className={
          boardShell
            ? 'board-topbar-nav flex h-[72px] min-w-0 max-w-full items-center gap-1 px-3 sm:gap-2 sm:px-5 lg:gap-3 lg:px-6'
            : `flex items-center gap-2 px-5 lg:gap-3 lg:px-6 h-14`
        }
      >
        {showProjectSidebar || showOrgNav ? (
          <IconButton
            label={showOrgNav ? 'Open organization navigation' : 'Open project navigation'}
            size="sm"
            className="lg:hidden"
            onClick={() => {
              setMobileNavOpen(true);
            }}
          >
            <Menu className="size-4" aria-hidden="true" />
          </IconButton>
        ) : null}
        <Link
          to="/"
          className={
            boardShell
              ? 'flex min-w-0 shrink items-center gap-2 text-lg font-semibold tracking-tight text-fg no-underline hover:text-accent'
              : 'flex shrink-0 items-center gap-2 text-lg font-semibold tracking-tight text-fg no-underline hover:text-accent'
          }
        >
          <span
            className={
              orgDashboardHome
                ? 'flex size-8 items-center justify-center rounded-lg bg-[var(--org-dash-accent)] text-white'
                : boardShell
                  ? 'board-logo flex size-8 shrink-0 items-center justify-center rounded-lg'
                  : 'flex size-8 items-center justify-center rounded-lg bg-accent text-accent-fg'
            }
          >
            <LayoutGrid className="size-4" aria-hidden="true" />
          </span>
          {boardShell ? <span className="hidden sm:inline">Jira Project</span> : 'Jira Project'}
        </Link>
        {signedIn ? (
          boardShell ? (
            <div className="board-topbar-context flex min-w-0 shrink items-center">
              <OrgMenu />
              <ProjectSwitcher />
            </div>
          ) : (
            <>
              <OrgMenu />
              <ProjectSwitcher />
            </>
          )
        ) : null}
        {showGlobalSearch ? (
          <GlobalSearchBar
            className={
              boardShell
                ? 'board-topbar-search min-w-0 max-w-xl flex-1 max-sm:mx-0 sm:mx-2 lg:max-w-2xl'
                : 'mx-2 max-w-xl lg:max-w-2xl'
            }
            orgDashboard={orgDashboardHome}
            boardChrome={boardShell}
          />
        ) : (
          <div className="flex-1" />
        )}
        {signedIn ? <SignedInActions boardShell={boardShell} /> : <GuestNav />}
      </nav>
    </header>
  );
}
