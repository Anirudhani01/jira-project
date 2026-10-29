import { useEffect } from 'react';
import { Link, useParams } from 'react-router';

import { ErrorState, LoadingState } from '../../../components/ui/States';
import { ApiError } from '../../../lib/api/errors';
import { NotFoundPage } from '../../../app/pages/NotFoundPage';
import { ProjectList } from '../../projects/ProjectList';
import { rememberOrg, useOrg } from '../api';

/** Org landing page: the projects the caller can see. */
export function OrgHomePage() {
  const { org: slug = '' } = useParams();
  const org = useOrg(slug);

  useEffect(() => {
    if (org.data) rememberOrg(org.data.slug);
  }, [org.data]);

  if (org.isPending) return <LoadingState label="Loading organization" />;
  if (org.error instanceof ApiError && org.error.status === 404) return <NotFoundPage />;
  if (org.isError) return <ErrorState error={org.error} onRetry={() => void org.refetch()} />;

  const canManage = org.data.permissions.includes('org.manage');
  return (
    <section aria-labelledby="org-title" className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 id="org-title" className="text-2xl font-semibold">
          {org.data.name}
        </h1>
        <div className="flex gap-4">
          <Link to={`/o/${org.data.slug}/settings/members`} className="text-blue-700 underline">
            Members
          </Link>
          {org.data.permissions.includes('org.audit.view') ? (
            <Link to={`/o/${org.data.slug}/settings/audit`} className="text-blue-700 underline">
              Audit log
            </Link>
          ) : null}
          {canManage ? (
            <Link to={`/o/${org.data.slug}/settings`} className="text-blue-700 underline">
              Settings
            </Link>
          ) : null}
        </div>
      </div>
      <section aria-labelledby="projects-title" className="space-y-2">
        <h2 id="projects-title" className="text-lg font-semibold">
          Projects
        </h2>
        <ProjectList
          org={org.data.slug}
          canCreate={org.data.permissions.includes('project.create')}
        />
      </section>
    </section>
  );
}
