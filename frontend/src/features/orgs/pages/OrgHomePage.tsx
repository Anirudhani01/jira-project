import { useMemo } from 'react';
import { useParams } from 'react-router';

import { useProjects } from '../../projects/api';
import { OrgDashboardSidebar } from '../dashboard/OrgDashboardSidebar';
import { useOrgDashboardStats } from '../dashboard/hooks/useOrgDashboardStats';
import { OrgGetStartedSection } from '../dashboard/OrgGetStartedSection';
import { OrgRecentlyOpenedCard } from '../dashboard/OrgRecentlyOpenedCard';
import { ProjectDashboardSection } from '../dashboard/ProjectDashboardSection';
import { useOrg } from '../api';

/** Projects tab of the organization dashboard (the header and tabs come from
 * `OrgDashboardLayout`, which has already loaded the organization). */
export function OrgHomePage() {
  const { org: slug = '' } = useParams();
  const org = useOrg(slug);
  const projects = useProjects(slug);
  const stats = useOrgDashboardStats(slug);

  const firstProjectKey = useMemo(() => {
    const active = (projects.data ?? []).filter((p) => !p.archived);
    return active[0]?.key ?? null;
  }, [projects.data]);

  if (!org.data) return null;

  const canCreate = org.data.permissions.includes('project.create');
  const canInvite = org.data.permissions.includes('org.members.manage');
  const showAudit = org.data.permissions.includes('org.audit.view');

  return (
    <div className="grid gap-6 sm:gap-8 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-8 sm:space-y-10">
        <ProjectDashboardSection org={org.data.slug} canCreate={canCreate} />
        <OrgGetStartedSection
          orgSlug={org.data.slug}
          canCreateProject={canCreate}
          canInviteMembers={canInvite}
          firstProjectKey={firstProjectKey}
          projectCount={stats.projectsReady ? stats.projectCount : null}
          memberCount={stats.membersReady ? stats.memberCount : null}
        />
        <OrgRecentlyOpenedCard orgSlug={org.data.slug} />
      </div>
      <OrgDashboardSidebar orgSlug={org.data.slug} canViewAudit={showAudit} />
    </div>
  );
}
