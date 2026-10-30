import { useMembers } from '../api';

import { useOrgDashboardStats } from './hooks/useOrgDashboardStats';
import { OrgOverviewCard } from './OrgOverviewCard';
import { OrgRecentActivityCard } from './OrgRecentActivityCard';

export function OrgDashboardSidebar({
  orgSlug,
  orgName,
  canViewAudit,
}: {
  orgSlug: string;
  orgName: string;
  canViewAudit: boolean;
}) {
  const members = useMembers(orgSlug);
  const stats = useOrgDashboardStats(orgSlug);

  return (
    <aside
      aria-label="Organization insights"
      className="flex flex-col gap-4 xl:sticky xl:top-6 xl:self-start"
    >
      <OrgOverviewCard
        orgName={orgName}
        projectCount={stats.projectsReady ? stats.projectCount : null}
        memberCount={stats.membersReady ? stats.memberCount : null}
        issueTotal={stats.issueTotal}
        issueTotalPending={stats.issueTotalPending && stats.projectsReady}
      />
      <OrgRecentActivityCard
        orgSlug={orgSlug}
        canViewAudit={canViewAudit}
        members={members.data}
        membersPending={members.isPending}
      />
    </aside>
  );
}
