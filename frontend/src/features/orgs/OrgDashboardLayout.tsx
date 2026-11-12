import { useEffect } from 'react';
import { Outlet, useParams } from 'react-router';

import { NotFoundPage } from '../../app/pages/NotFoundPage';
import { PageHeaderLevelContext } from '../../components/ui/pageHeaderLevel';
import { ErrorState, LoadingState } from '../../components/ui/States';
import { ApiError } from '../../lib/api/errors';

import { OrgDashboardHeader } from './dashboard/OrgDashboardHeader';
import { OrgDashboardTabs } from './dashboard/OrgDashboardTabs';
import { useOrgDashboardStats } from './dashboard/hooks/useOrgDashboardStats';
import { rememberOrg, useOrg } from './api';

/** Organization dashboard frame: header and tabs stay put while the tab content (Projects,
 * Members, Audit log, Settings) changes below them. Administration keeps everything else. */
export function OrgDashboardLayout() {
  const { org: slug = '' } = useParams();
  const org = useOrg(slug);
  const stats = useOrgDashboardStats(slug);

  useEffect(() => {
    if (org.data) rememberOrg(org.data.slug);
  }, [org.data]);

  if (org.isPending) return <LoadingState label="Loading organization" />;
  if (org.error instanceof ApiError && org.error.status === 404) return <NotFoundPage />;
  if (org.isError) return <ErrorState error={org.error} onRetry={() => void org.refetch()} />;

  const canCreate = org.data.permissions.includes('project.create');
  const canInvite = org.data.permissions.includes('org.members.manage');
  const showAudit = org.data.permissions.includes('org.audit.view');

  return (
    <div className="org-dashboard mx-auto w-full min-w-0 max-w-[1280px] space-y-6 sm:space-y-8">
      <OrgDashboardHeader
        orgName={org.data.name}
        orgSlug={org.data.slug}
        canCreateProject={canCreate}
        canInviteMembers={canInvite}
        projectCount={stats.projectsReady ? stats.projectCount : null}
        issueTotal={stats.projectsReady ? stats.issueTotal : null}
        memberCount={stats.membersReady ? stats.memberCount : null}
      />
      <OrgDashboardTabs orgSlug={org.data.slug} showAudit={showAudit} />
      {/* The organization name above is the page's h1; tab pages title themselves with h2. */}
      <PageHeaderLevelContext.Provider value={2}>
        <Outlet />
      </PageHeaderLevelContext.Provider>
    </div>
  );
}
