import { Link, Outlet, useNavigate } from 'react-router';

import { useLogout, useSession } from '../features/auth/api';
import { OrgNotificationBell } from '../features/notifications/NotificationBell';
import { OrgSwitcher } from '../features/orgs/OrgSwitcher';

function UserNav() {
  const session = useSession();
  const logout = useLogout();
  const navigate = useNavigate();

  if (session.isPending) return null;
  if (!session.data) {
    return (
      <div className="flex items-center gap-4 text-sm">
        <Link to="/login" className="hover:underline">
          Sign in
        </Link>
        <Link to="/signup" className="rounded bg-blue-700 px-3 py-1.5 text-white hover:bg-blue-800">
          Sign up
        </Link>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-4 text-sm">
      <OrgSwitcher />
      <OrgNotificationBell />
      <Link to="/account" className="hover:underline">
        {session.data.user.display_name}
      </Link>
      <button
        type="button"
        disabled={logout.isPending}
        onClick={() => {
          logout.mutate(undefined, { onSuccess: () => void navigate('/login') });
        }}
        className="text-slate-700 hover:underline disabled:opacity-60"
      >
        Sign out
      </button>
      {logout.isError ? (
        <span role="alert" className="text-red-700">
          Sign-out failed. Try again.
        </span>
      ) : null}
    </div>
  );
}

export function AppShell() {
  return (
    <div className="flex min-h-screen flex-col bg-slate-50 text-slate-900">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:rounded focus:bg-white focus:px-3 focus:py-2 focus:shadow"
      >
        Skip to content
      </a>
      <header className="border-b border-slate-200 bg-white">
        <nav
          aria-label="Primary"
          className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4"
        >
          <Link to="/" className="text-lg font-semibold tracking-tight">
            Jira Project
          </Link>
          <UserNav />
        </nav>
      </header>
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}
