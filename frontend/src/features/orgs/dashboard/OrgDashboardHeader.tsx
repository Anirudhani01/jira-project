import { Link } from 'react-router';

import { Button } from '../../../components/ui/Button';
import { useSession } from '../../auth/api';

export function OrgDashboardHeader({
  orgName,
  orgSlug,
  canCreateProject,
  canInviteMembers,
}: {
  orgName: string;
  orgSlug: string;
  canCreateProject: boolean;
  canInviteMembers: boolean;
}) {
  const session = useSession();
  const displayName = session.data?.user.display_name ?? '';
  const firstName = displayName.split(/\s+/)[0] || 'there';

  return (
    <header className="org-dash-header space-y-4 sm:space-y-5">
      <div className="space-y-1.5">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--org-dash-accent)]">
          Welcome back,
        </p>
        <h1 className="text-[1.625rem] font-bold leading-tight tracking-tight text-[var(--org-dash-text)] sm:text-[1.875rem] lg:text-[2rem]">
          {orgName}
        </h1>
        <p className="max-w-2xl text-sm leading-relaxed text-[var(--org-dash-muted)]">
          Manage your projects, track progress, and keep your team aligned.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {canInviteMembers ? (
          <Button variant="secondary" size="sm" className="org-dash-btn-secondary" asChild>
            <Link to={`/o/${orgSlug}/settings/members`}>Invite members</Link>
          </Button>
        ) : null}
        {canCreateProject ? (
          <Button variant="primary" size="sm" className="org-dash-btn-primary" asChild>
            <Link to={`/o/${orgSlug}/projects/new`}>Create project</Link>
          </Button>
        ) : null}
      </div>
      <p className="sr-only">Signed in as {firstName}</p>
    </header>
  );
}
