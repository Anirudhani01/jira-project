import { FolderKanban, UserPlus, ListTodo } from 'lucide-react';
import { Link } from 'react-router';

import { Card } from '../../../components/ui/Card';
import { cn } from '../../../lib/cn';

function GetStartedCard({
  icon: Icon,
  title,
  description,
  to,
  disabled,
  disabledReason,
}: {
  icon: typeof FolderKanban;
  title: string;
  description: string;
  to: string;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const body = (
    <Card
      className={cn(
        'org-dash-card flex h-full flex-col gap-3 p-4 transition-colors',
        !disabled && 'hover:border-[var(--org-dash-accent)]',
      )}
    >
      <span className="org-dash-on-accent-soft flex size-10 items-center justify-center rounded-lg bg-[var(--org-dash-accent-soft)]">
        <Icon className="size-5" aria-hidden />
      </span>
      <div>
        <h3 className="text-sm font-semibold text-[var(--org-dash-text)]">{title}</h3>
        <p className="mt-1 text-sm leading-relaxed text-[var(--org-dash-muted)]">{description}</p>
      </div>
    </Card>
  );

  if (disabled) {
    return (
      <div className="h-full cursor-not-allowed" title={disabledReason} aria-disabled="true">
        <Card className="org-dash-card flex h-full flex-col gap-3 p-4 opacity-90">
          <span className="org-dash-on-accent-soft flex size-10 items-center justify-center rounded-lg bg-[var(--org-dash-accent-soft)]">
            <Icon className="size-5" aria-hidden />
          </span>
          <div>
            <h3 className="text-sm font-semibold text-[var(--org-dash-muted)]">{title}</h3>
            <p className="mt-1 text-sm leading-relaxed text-[var(--org-dash-muted)]">
              {description}
            </p>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <Link
      to={to}
      className="block h-full no-underline outline-none focus-visible:ring-2 focus-visible:ring-[var(--org-dash-accent)]"
    >
      {body}
    </Link>
  );
}

export function OrgGetStartedSection({
  orgSlug,
  canCreateProject,
  canInviteMembers,
  firstProjectKey,
}: {
  orgSlug: string;
  canCreateProject: boolean;
  canInviteMembers: boolean;
  firstProjectKey: string | null;
}) {
  const trackHref = firstProjectKey
    ? `/o/${orgSlug}/p/${firstProjectKey}/issues`
    : `/o/${orgSlug}/projects/new`;

  return (
    <section aria-labelledby="get-started-title" className="space-y-4">
      <h2 id="get-started-title" className="text-base font-semibold text-[var(--org-dash-text)]">
        Get started
      </h2>
      <div className="grid gap-4 md:grid-cols-3">
        <GetStartedCard
          icon={FolderKanban}
          title="Create a project"
          description="Start by creating a project for your team."
          to={`/o/${orgSlug}/projects/new`}
          disabled={!canCreateProject}
          disabledReason="You do not have permission to create projects"
        />
        <GetStartedCard
          icon={UserPlus}
          title="Invite your team"
          description="Add team members and set up roles."
          to={`/o/${orgSlug}/settings/members`}
          disabled={!canInviteMembers}
          disabledReason="You do not have permission to invite members"
        />
        <GetStartedCard
          icon={ListTodo}
          title="Track work"
          description="Create issues and start tracking progress."
          to={trackHref}
        />
      </div>
    </section>
  );
}
