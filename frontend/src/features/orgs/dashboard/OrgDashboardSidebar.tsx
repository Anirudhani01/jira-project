import { useMembers } from '../api';

import { OrgRecentActivityCard } from './OrgRecentActivityCard';

/** Right column of the org dashboard: recent activity (totals live in the page header). */
export function OrgDashboardSidebar({
  orgSlug,
  canViewAudit,
}: {
  orgSlug: string;
  canViewAudit: boolean;
}) {
  const members = useMembers(orgSlug);

  return (
    <aside
      aria-label="Organization activity"
      className="flex flex-col gap-4 xl:sticky xl:top-20 xl:self-start"
    >
      <OrgRecentActivityCard
        orgSlug={orgSlug}
        canViewAudit={canViewAudit}
        members={members.data}
        membersPending={members.isPending}
      />
    </aside>
  );
}
