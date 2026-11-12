import { LayoutGrid, ShieldCheck } from 'lucide-react';

import { AuthBoardPreview } from './AuthBoardPreview';

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
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-line bg-surface text-fg-muted">
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <span className="text-sm leading-relaxed text-fg-muted">
        <span className="font-medium text-fg">{title}</span>
        {' · '}
        {description}
      </span>
    </li>
  );
}

/** Product showcase column for auth (desktop 62%): what the product does, then the product. */
export function AuthMarketingPanel({ className = '' }: { className?: string }) {
  return (
    <aside
      aria-hidden="true"
      className={`auth-marketing-panel relative flex min-h-0 flex-col justify-center overflow-x-hidden overflow-y-auto px-6 py-8 sm:px-8 lg:px-10 lg:py-10 xl:px-12 ${className}`}
    >
      <div className="mx-auto w-full max-w-xl">
        <h2 className="max-w-md text-3xl font-medium leading-tight text-fg xl:text-3xl">
          Boards, backlogs and issues for software teams
        </h2>
        <p className="mt-3 max-w-md text-base leading-relaxed text-fg-muted">
          Run each project on a Kanban board or in Scrum sprints, with workflows you edit and roles
          that decide who can change what.
        </p>
        <ul className="mt-8 max-w-md space-y-4">
          <FeatureRow
            icon={LayoutGrid}
            title="Kanban and Scrum"
            description="Boards, backlogs, sprints and versions per project"
          />
          <FeatureRow
            icon={ShieldCheck}
            title="Roles and audit log"
            description="Owner, admin and member roles, with every organization change recorded"
          />
        </ul>
        <div className="mt-10">
          <AuthBoardPreview />
        </div>
      </div>
    </aside>
  );
}
