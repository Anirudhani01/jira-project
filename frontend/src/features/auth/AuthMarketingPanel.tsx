import { LayoutGrid, Users } from 'lucide-react';

import { AuthBoardPreview } from './AuthBoardPreview';
import { authEyebrowClass } from './authUi';

function FeatureRow({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof LayoutGrid;
  title: string;
  description: string;
}) {
  return (
    <li className="flex gap-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-fg shadow-sm">
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <span className="text-sm leading-relaxed text-fg-muted">
        <span className="font-semibold text-fg">{title}</span>
        {' — '}
        {description}
      </span>
    </li>
  );
}

/** Product showcase column for auth (desktop 62%). */
export function AuthMarketingPanel({ className = '' }: { className?: string }) {
  return (
    <aside
      aria-hidden="true"
      className={`auth-marketing-panel relative flex min-h-0 flex-col justify-center overflow-x-hidden overflow-y-auto px-6 py-8 sm:px-8 lg:py-10 lg:px-10 xl:px-12 ${className}`}
    >
      <div
        className="pointer-events-none absolute -left-20 top-10 size-64 rounded-full border border-accent/10 bg-accent/5"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute right-[-4rem] top-1/3 size-96 rounded-full border border-accent/10 bg-white/40 dark:bg-accent/5"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute bottom-12 left-1/4 size-48 rounded-full bg-accent/10 blur-2xl"
        aria-hidden="true"
      />
      <svg
        className="pointer-events-none absolute right-8 top-24 h-32 w-32 text-accent/15"
        viewBox="0 0 100 100"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M10 80 Q 50 20 90 60"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
      <div className="relative z-[1] mx-auto w-full max-w-xl">
        <p className={authEyebrowClass}>Jira project</p>
        <h2 className="mt-3 max-w-md text-[1.75rem] font-bold leading-tight tracking-tight text-fg xl:text-3xl">
          Plan, track, and ship work in one place
        </h2>
        <p className="mt-3 max-w-md text-sm leading-relaxed text-fg-muted">
          Bring your team, projects, and priorities together in one clear workspace.
        </p>
        <ul className="mt-8 max-w-md space-y-5">
          <FeatureRow
            icon={LayoutGrid}
            title="Flexible boards and workflows"
            description="Plan and track work your way."
          />
          <FeatureRow
            icon={Users}
            title="Teams, roles, and secure access"
            description="Keep your work organized and your data safe."
          />
        </ul>
        <div className="relative mt-8 max-lg:scale-[0.92] max-lg:origin-top lg:mt-10 lg:translate-x-2">
          <AuthBoardPreview />
        </div>
      </div>
    </aside>
  );
}
