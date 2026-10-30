import { Outlet } from 'react-router';

import { cn } from '../lib/cn';
import { Breadcrumbs } from './shell/Breadcrumbs';
import { MobileProjectDrawer, ProjectSidebar } from './shell/ProjectSidebar';
import { ShellProvider } from './shell/ShellContext';
import { TopBar } from './shell/TopBar';
import { useAuthRoute } from '../features/auth/useAuthRoute';

import { useShowProjectSidebar } from './shell/useProjectContext';

function AppShellBody() {
  const inProject = useShowProjectSidebar();
  const authRoute = useAuthRoute();

  return (
    <div
      className={cn('flex min-h-screen flex-col text-fg', authRoute ? 'bg-surface' : 'bg-bg')}
    >
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[70] focus:rounded focus:bg-surface focus:px-3 focus:py-2 focus:shadow"
      >
        Skip to content
      </a>
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <ProjectSidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          {inProject ? <Breadcrumbs /> : null}
          <main
            id="main"
            className={
              inProject
                ? 'flex-1 px-4 py-6 sm:px-6 lg:px-8'
                : authRoute
                  ? 'flex-1 p-0'
                  : 'mx-auto w-full max-w-6xl flex-1 px-4 py-8'
            }
          >
            <Outlet />
          </main>
        </div>
      </div>
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
