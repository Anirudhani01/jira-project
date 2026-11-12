import { ChevronRight, FolderKanban, ListTodo, UserPlus } from 'lucide-react';
import { Link } from 'react-router';

import { Card } from '../../../components/ui/Card';
import { cn } from '../../../lib/cn';

const ROW =
  'flex items-center gap-3 px-4 py-3 text-left no-underline outline-none focus-visible:bg-[var(--surface-hover)]';

function Step({
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
  const content = (
    <>
      <Icon className="size-4 shrink-0 text-[var(--org-dash-muted)]" aria-hidden />
      <span className="min-w-0 flex-1">
        <h3
          className={cn(
            'text-sm font-medium',
            disabled ? 'text-[var(--org-dash-muted)]' : 'text-[var(--org-dash-text)]',
          )}
        >
          {title}
        </h3>
        <p className="text-sm text-[var(--org-dash-muted)]">{description}</p>
      </span>
      {disabled ? null : (
        <ChevronRight className="size-4 shrink-0 text-[var(--org-dash-muted)]" aria-hidden />
      )}
    </>
  );

  if (disabled) {
    return (
      <li>
        <div className={cn(ROW, 'cursor-not-allowed')} title={disabledReason} aria-disabled="true">
          {content}
        </div>
      </li>
    );
  }
  return (
    <li>
      <Link to={to} className={cn(ROW, 'transition-colors hover:bg-[var(--surface-hover)]')}>
        {content}
      </Link>
    </li>
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
    <section aria-labelledby="get-started-title" className="space-y-3">
      <h2 id="get-started-title" className="text-base font-medium text-[var(--org-dash-text)]">
        Get started
      </h2>
      <Card className="org-dash-card overflow-hidden">
        <ul className="divide-y divide-[var(--org-dash-border)]">
          <Step
            icon={FolderKanban}
            title="Create a project"
            description="Start by creating a project for your team"
            to={`/o/${orgSlug}/projects/new`}
            disabled={!canCreateProject}
            disabledReason="You do not have permission to create projects"
          />
          <Step
            icon={UserPlus}
            title="Invite your team"
            description="Add team members and set up roles"
            to={`/o/${orgSlug}/settings/members`}
            disabled={!canInviteMembers}
            disabledReason="You do not have permission to invite members"
          />
          <Step
            icon={ListTodo}
            title="Track work"
            description="Create issues and start tracking progress"
            to={trackHref}
          />
        </ul>
      </Card>
    </section>
  );
}
