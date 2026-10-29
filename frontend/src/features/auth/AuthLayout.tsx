import type { ReactNode } from 'react';
import { LayoutGrid, Users } from 'lucide-react';

/** Split layout for sign-in flows: form column + short product panel (lg+). */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-[calc(100dvh-3.5rem)] flex-col lg:flex-row lg:-mx-4 lg:-my-6">
      <div className="flex flex-1 flex-col justify-center px-1 py-8 sm:px-4 lg:max-w-md lg:px-10 xl:max-w-lg">
        {children}
      </div>
      <aside
        aria-hidden="true"
        className="hidden flex-1 flex-col justify-center border-l border-line bg-surface-2 px-10 py-12 lg:flex"
      >
        <p className="font-mono text-xs uppercase tracking-wide text-fg-muted">Jira Project</p>
        <h2 className="mt-3 max-w-md text-2xl font-semibold text-fg">
          Plan, track, and ship work in one place
        </h2>
        <p className="mt-3 max-w-md text-sm text-fg-muted">
          Boards, backlogs, and issues for your team — without changing how your data is stored or
          shared.
        </p>
        <ul className="mt-8 max-w-md space-y-4 text-sm text-fg-muted">
          <li className="flex gap-3">
            <LayoutGrid className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden="true" />
            <span>Kanban and Scrum projects with workflows you control</span>
          </li>
          <li className="flex gap-3">
            <Users className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden="true" />
            <span>Organizations, roles, and audit-friendly membership</span>
          </li>
        </ul>
      </aside>
    </div>
  );
}
