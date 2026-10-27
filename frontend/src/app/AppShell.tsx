import { Link, Outlet } from 'react-router';

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
        <nav aria-label="Primary" className="mx-auto flex h-14 max-w-6xl items-center px-4">
          <Link to="/" className="text-lg font-semibold tracking-tight">
            Jira Project
          </Link>
        </nav>
      </header>
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}
