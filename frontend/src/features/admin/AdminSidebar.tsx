import { AdminSidebarNav } from './AdminSidebarNav';

export function AdminSidebar({
  orgSlug,
  orgName,
  permissions,
}: {
  orgSlug: string;
  orgName: string;
  permissions: string[];
}) {
  return (
    <aside
      className="admin-sidebar hidden w-60 shrink-0 border-r border-[var(--admin-border)] bg-[var(--admin-surface)] lg:block"
      aria-label="Administration sidebar"
    >
      <AdminSidebarNav orgSlug={orgSlug} orgName={orgName} permissions={permissions} />
    </aside>
  );
}
