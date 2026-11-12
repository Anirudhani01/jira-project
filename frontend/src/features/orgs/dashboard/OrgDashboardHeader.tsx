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
      <div className="space-y-2">
        <h1 className="text-3xl font-medium leading-tight text-[var(--org-dash-text)] sm:text-3xl lg:text-3xl">
          {orgName}
        </h1>
        <p className="max-w-2xl text-sm leading-relaxed text-[var(--org-dash-muted)]">
          Projects, members and recent activity for this organization
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
