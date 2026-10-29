import { useEffect } from 'react';
import { Link, useParams } from 'react-router';

import { PageHeader } from '../../../components/ui/PageHeader';
import { Button } from '../../../components/ui/Button';
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
  const canCreate = org.data.permissions.includes('project.create');

  return (
    <div className="space-y-8">
      <PageHeader
        title={org.data.name}
        description="Projects in this organization"
        actions={
          <>
            <Button variant="ghost" size="sm" asChild>
              <Link to={`/o/${org.data.slug}/settings/members`}>Members</Link>
            </Button>
            {org.data.permissions.includes('org.audit.view') ? (
              <Button variant="ghost" size="sm" asChild>
                <Link to={`/o/${org.data.slug}/settings/audit`}>Audit log</Link>
              </Button>
            ) : null}
            {canManage ? (
              <Button variant="secondary" size="sm" asChild>
                <Link to={`/o/${org.data.slug}/settings`}>Settings</Link>
              </Button>
            ) : null}
          </>
        }
      />
      <section aria-labelledby="projects-title" className="space-y-4">
        <h2 id="projects-title" className="text-lg font-semibold text-fg">
          Projects
        </h2>
        <ProjectList org={org.data.slug} canCreate={canCreate} />
      </section>
    </div>
  );
}
