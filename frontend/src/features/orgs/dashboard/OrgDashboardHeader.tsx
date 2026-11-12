import { Link } from 'react-router';

import { Button } from '../../../components/ui/Button';
import { useSession } from '../../auth/api';

function Total({
  value,
  singular,
  plural,
}: {
  value: number | null;
  singular: string;
  plural: string;
}) {
  return (
    <span>
      <b className="font-semibold tabular-nums text-[var(--org-dash-text)]">{value ?? '—'}</b>{' '}
      {value === 1 ? singular : plural}
    </span>
  );
}

export function OrgDashboardHeader({
  orgName,
  orgSlug,
  canCreateProject,
  canInviteMembers,
  projectCount,
  issueTotal,
  memberCount,
}: {
  orgName: string;
  orgSlug: string;
  canCreateProject: boolean;
  canInviteMembers: boolean;
  /** Totals once loaded; `null` while loading or on error (shown as "—"). */
  projectCount: number | null;
  issueTotal: number | null;
  memberCount: number | null;
}) {
  const session = useSession();
  const displayName = session.data?.user.display_name ?? '';
  const firstName = displayName.split(/\s+/)[0] || 'there';

  return (
    <header className="org-dash-header flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div className="space-y-1.5">
        <h1 className="text-3xl font-semibold leading-tight tracking-tight text-[var(--org-dash-text)]">
          {orgName}
        </h1>
        <p
          className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-[var(--org-dash-muted)]"
          aria-label="Organization totals"
        >
          <Total value={projectCount} singular="project" plural="projects" />
          <Total value={issueTotal} singular="issue" plural="issues" />
          <Total value={memberCount} singular="member" plural="members" />
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
            <Link to={`/o/${orgSlug}/projects/new`}>New project</Link>
          </Button>
        ) : null}
      </div>
      <p className="sr-only">Signed in as {firstName}</p>
    </header>
  );
}
