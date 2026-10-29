import { Menu, Plus, Search } from 'lucide-react';
import { Link, useNavigate } from 'react-router';

import { Button, IconButton } from '../../components/ui/Button';
import { useSession } from '../../features/auth/api';
import { OrgNotificationBell } from '../../features/notifications/NotificationBell';

import { OrgMenu } from './OrgMenu';
import { ProfileMenu } from './ProfileMenu';
import { ProjectSwitcher } from './ProjectSwitcher';
import { useShell } from './ShellContext';
import { ThemeToggle } from './ThemeToggle';
import { useProjectContext, useShowProjectSidebar } from './useProjectContext';

function GuestNav() {
  return (
    <div className="flex items-center gap-2 text-sm">
      <Button variant="ghost" size="sm" asChild>
        <Link to="/login">Sign in</Link>
      </Button>
      <Button variant="primary" size="sm" asChild>
        <Link to="/signup">Sign up</Link>
      </Button>
    </div>
  );
}

function SignedInActions() {
  const ctx = useProjectContext();
  const navigate = useNavigate();

  return (
    <div className="flex items-center gap-1">
      {ctx?.projectKey ? (
        <Button
          variant="primary"
          size="sm"
          className="hidden sm:inline-flex"
          onClick={() => {
            void navigate(`/o/${ctx.org}/p/${ctx.projectKey}/issues`);
          }}
        >
          <Plus className="size-4" aria-hidden="true" />
          Create
        </Button>
      ) : null}
      <IconButton
        label="Search issues"
        size="sm"
        className="hidden sm:inline-flex"
        onClick={() => {
          if (ctx?.projectKey) {
            void navigate(`/o/${ctx.org}/p/${ctx.projectKey}/issues`);
          }
        }}
        disabled={!ctx?.projectKey}
      >
        <Search className="size-4" aria-hidden="true" />
      </IconButton>
      {ctx?.org ? <OrgNotificationBell /> : null}
      <ThemeToggle />
      <ProfileMenu />
    </div>
  );
}

export function TopBar() {
  const session = useSession();
  const { setMobileNavOpen } = useShell();
  const showSidebar = useShowProjectSidebar();
  const signedIn = Boolean(session.data);

  return (
    <header className="border-b border-line bg-surface">
      <nav aria-label="Primary" className="flex h-14 items-center gap-2 px-4">
        {showSidebar ? (
          <IconButton
            label="Open project navigation"
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
          className="shrink-0 text-lg font-semibold tracking-tight text-accent no-underline hover:text-accent-hover"
        >
          Jira Project
        </Link>
        {signedIn ? (
          <>
            <OrgMenu />
            <ProjectSwitcher />
          </>
        ) : null}
        <div className="flex-1" />
        {signedIn ? <SignedInActions /> : <GuestNav />}
      </nav>
    </header>
  );
}
