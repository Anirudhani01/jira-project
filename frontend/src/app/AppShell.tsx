import { UxOfflineNotice } from '../components/ux/UxOfflineNotice';

import { cn } from '../lib/cn';

import { useAppOnline } from './OnlineStatusProvider';

import { MainOutlet } from './MainOutlet';
import { useAuthRoute } from '../features/auth/useAuthRoute';

import { Breadcrumbs } from './shell/Breadcrumbs';
import { MobileOrgDrawer, OrgSidebar } from './shell/OrgSidebar';
import { MobileProjectDrawer, ProjectSidebar } from './shell/ProjectSidebar';
import { ShellProvider } from './shell/ShellContext';
import { TopBar } from './shell/TopBar';
import { useBoardShell } from './shell/useBoardShell';
import { useAdminShell } from './shell/useAdminShell';
import { useOrgDashboardHome, useShowOrgSidebar } from './shell/useOrgShell';
import { useShowProjectSidebar } from './shell/useProjectContext';

function AppShellBody() {
  const online = useAppOnline();
  const inProject = useShowProjectSidebar();
  const inOrgShell = useShowOrgSidebar();
  const inAdminShell = useAdminShell();
  const orgDashboardHome = useOrgDashboardHome();
  const boardShell = useBoardShell();
  const authRoute = useAuthRoute();

  return (
    <div
      className={cn(
        'flex min-h-screen flex-col text-fg',
        authRoute && 'bg-surface',
        !authRoute &&
          orgDashboardHome &&
          'org-dashboard-shell w-full min-w-0 overflow-x-hidden',
        !authRoute && inAdminShell && 'admin-shell',
        !authRoute && boardShell && 'board-shell w-full min-w-0 overflow-x-hidden',
        !authRoute && !orgDashboardHome && !inAdminShell && !boardShell && 'bg-bg',
      )}
    >
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[70] focus:rounded focus:bg-surface focus:px-3 focus:py-2 focus:shadow"
      >
        Skip to content
      </a>
      <TopBar orgDashboardHome={orgDashboardHome} boardShell={boardShell} />
      {!online ? (
        <div className="px-4 pt-2 sm:px-6 lg:px-8">
          <UxOfflineNotice offline variant="banner" />
        </div>
      ) : null}
      <div
        className={cn(
          'flex min-h-0 flex-1',
          (boardShell || orgDashboardHome) && 'min-w-0 max-w-full overflow-x-hidden',
        )}
      >
        <OrgSidebar />
        <ProjectSidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          {inProject && !boardShell ? <Breadcrumbs /> : null}
          <main
            id="main"
            className={cn(
              'flex-1 min-w-0',
              inProject && boardShell && 'board-main px-3 py-4 sm:px-4 lg:px-5',
              inProject && !boardShell && 'px-4 py-6 sm:px-6 lg:px-8',
              authRoute && 'p-0',
              !inProject &&
                !authRoute &&
                (inAdminShell
                  ? 'flex min-h-0 min-w-0 flex-1 flex-col p-0'
                  : orgDashboardHome
                    ? 'px-4 py-6 sm:px-6 lg:px-8'
                    : inOrgShell
                      ? 'mx-auto w-full max-w-6xl px-4 py-8'
                      : 'mx-auto w-full max-w-6xl px-4 py-8'),
            )}
          >
            <MainOutlet />
          </main>
        </div>
      </div>
      <MobileOrgDrawer />
      <MobileProjectDrawer />
    </div>
  );
}

export function AppShell() {
  return (
    <ShellProvider>
      <AppShellBody />
    </ShellProvider>
  );
}
