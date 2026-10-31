import { Outlet, useParams } from 'react-router';

import { ErrorState, LoadingState } from '../../components/ui/States';
import { NotFoundPage } from '../../app/pages/NotFoundPage';
import { ApiError } from '../../lib/api/errors';
import { useOrg } from '../orgs/api';

import { AdminBreadcrumbs } from './AdminBreadcrumbs';
import { AdminMobileDrawer, AdminMobileMenuButton } from './AdminMobileDrawer';
import { AdminSidebar } from './AdminSidebar';

export function AdminShellLayout() {
  const { org: slug = '' } = useParams();
  const org = useOrg(slug);

  if (org.isPending) {
    return (
      <div className="admin-page min-h-[40vh] px-4 py-10">
        <LoadingState label="Loading administration" />
      </div>
    );
  }
  if (org.error instanceof ApiError && org.error.status === 404) return <NotFoundPage />;
  if (org.isError) return <ErrorState error={org.error} onRetry={() => void org.refetch()} />;

  const permissions = org.data.permissions;

  return (
    <div className="admin-shell-inner flex min-h-0 min-w-0 flex-1 flex-col lg:flex-row">
      <AdminSidebar orgSlug={org.data.slug} orgName={org.data.name} permissions={permissions} />
      <AdminMobileDrawer
        orgSlug={org.data.slug}
        orgName={org.data.name}
        permissions={permissions}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-[var(--admin-border)] bg-[var(--admin-surface)] px-4 py-2 lg:hidden">
          <AdminMobileMenuButton />
          <span className="text-sm font-medium text-[var(--admin-text)]">Administration</span>
        </div>
        <AdminBreadcrumbs orgSlug={org.data.slug} orgName={org.data.name} />
        <div className="admin-page min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto w-full max-w-5xl">
            <Outlet />
          </div>
        </div>
      </div>
    </div>
  );
}
