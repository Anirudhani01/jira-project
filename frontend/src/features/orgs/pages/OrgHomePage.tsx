import { useEffect, useMemo } from 'react';
import { useParams } from 'react-router';

import { ErrorState, LoadingState } from '../../../components/ui/States';
import { ApiError } from '../../../lib/api/errors';
import { NotFoundPage } from '../../../app/pages/NotFoundPage';
import { useProjects } from '../../projects/api';
import { OrgDashboardHeader } from '../dashboard/OrgDashboardHeader';
import { OrgDashboardSidebar } from '../dashboard/OrgDashboardSidebar';
import { OrgDashboardTabs } from '../dashboard/OrgDashboardTabs';
import { OrgGetStartedSection } from '../dashboard/OrgGetStartedSection';
import { OrgPromoBanner } from '../dashboard/OrgPromoBanner';
import { ProjectDashboardSection } from '../dashboard/ProjectDashboardSection';
import { rememberOrg, useOrg } from '../api';

/** Organization home dashboard (projects tab). */
export function OrgHomePage() {
  const { org: slug = '' } = useParams();
  const org = useOrg(slug);
  const projects = useProjects(slug);

  useEffect(() => {
    if (org.data) rememberOrg(org.data.slug);
  }, [org.data]);

  const firstProjectKey = useMemo(() => {
    const active = (projects.data ?? []).filter((p) => !p.archived);
    return active[0]?.key ?? null;
  }, [projects.data]);

  if (org.isPending) return <LoadingState label="Loading organization" />;
  if (org.error instanceof ApiError && org.error.status === 404) return <NotFoundPage />;
  if (org.isError) return <ErrorState error={org.error} onRetry={() => void org.refetch()} />;

  const canCreate = org.data.permissions.includes('project.create');
  const canInvite = org.data.permissions.includes('org.members.manage');
  const showAudit = org.data.permissions.includes('org.audit.view');
  const activeProjectCount = (projects.data ?? []).filter((p) => !p.archived).length;

  return (
    <div className="org-dashboard mx-auto w-full min-w-0 max-w-[1280px] space-y-6 sm:space-y-8">
      <OrgDashboardHeader
        orgName={org.data.name}
        orgSlug={org.data.slug}
        canCreateProject={canCreate}
        canInviteMembers={canInvite}
      />
      <OrgDashboardTabs orgSlug={org.data.slug} showAudit={showAudit} />
      <div className="grid gap-6 sm:gap-8 xl:grid-cols-[minmax(0,1fr)_280px]">
        <div className="min-w-0 space-y-8 sm:space-y-10">
          <ProjectDashboardSection org={org.data.slug} canCreate={canCreate} />
          <OrgGetStartedSection
            orgSlug={org.data.slug}
            canCreateProject={canCreate}
            canInviteMembers={canInvite}
            firstProjectKey={firstProjectKey}
          />
          <OrgPromoBanner
            orgSlug={org.data.slug}
            canCreateProject={canCreate && activeProjectCount > 0}
          />
        </div>
        <OrgDashboardSidebar
          orgSlug={org.data.slug}
          orgName={org.data.name}
          canViewAudit={showAudit}
        />
      </div>
    </div>
  );
}
