import type { ReactNode } from 'react';
import { useParams } from 'react-router';

import { PageHeader } from '../../../components/ui/PageHeader';
import { ErrorState, LoadingState } from '../../../components/ui/States';
import { UxPermissionDenied } from '../../../components/ux/UxPermissionDenied';
import { NotFoundPage } from '../../../app/pages/NotFoundPage';
import { ApiError } from '../../../lib/api/errors';
import { toUxPermissionDeniedProps } from '../../../lib/ux/permissionDenied';
import { useOrg } from '../../orgs/api';

/** Loads org context and restricts content to members with `org.manage` (owner/admin). */
export function AdminOrgManagePageFrame({
  title,
  titleId,
  description,
  children,
}: {
  title: string;
  titleId: string;
  description: string;
  children: ReactNode;
}) {
  const { org: slug = '' } = useParams();
  const org = useOrg(slug);

  if (org.isPending) {
    return <LoadingState label="Loading organization" />;
  }
  if (org.error instanceof ApiError && org.error.status === 404) {
    return <NotFoundPage />;
  }
  if (org.isError) {
    return <ErrorState error={org.error} onRetry={() => void org.refetch()} />;
  }
  if (!org.data.permissions.includes('org.manage')) {
    return <UxPermissionDenied {...toUxPermissionDeniedProps('org-settings', { orgSlug: slug })} />;
  }

  return (
    <div className="admin-page space-y-6">
      <PageHeader titleId={titleId} title={title} description={description} />
      {children}
    </div>
  );
}
