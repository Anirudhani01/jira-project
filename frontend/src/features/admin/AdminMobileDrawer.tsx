import { Menu } from 'lucide-react';

import { IconButton } from '../../components/ui/Button';
import { useShell } from '../../app/shell/ShellContext';

import { AdminSidebarNav } from './AdminSidebarNav';

export function AdminMobileMenuButton() {
  const { adminMobileNavOpen, setAdminMobileNavOpen } = useShell();
  return (
    <IconButton
      type="button"
      size="sm"
      className="lg:hidden"
      label="Open administration menu"
      aria-expanded={adminMobileNavOpen}
      aria-controls="admin-mobile-drawer"
      onClick={() => {
        setAdminMobileNavOpen(true);
      }}
    >
      <Menu className="size-5" aria-hidden />
    </IconButton>
  );
}

export function AdminMobileDrawer({
  orgSlug,
  orgName,
  permissions,
}: {
  orgSlug: string;
  orgName: string;
  permissions: string[];
}) {
  const { adminMobileNavOpen, setAdminMobileNavOpen } = useShell();
  if (!adminMobileNavOpen) return null;

  return (
    <div className="fixed inset-0 z-50 lg:hidden" id="admin-mobile-drawer">
      <button
        type="button"
        aria-label="Close administration menu"
        className="absolute inset-0 bg-slate-900/40"
        onClick={() => {
          setAdminMobileNavOpen(false);
        }}
      />
      <aside
        className="relative flex h-full w-[min(100%,16.5rem)] flex-col border-r border-[var(--admin-border)] bg-[var(--admin-surface)] shadow-lg"
        aria-label="Administration navigation"
      >
        <AdminSidebarNav
          orgSlug={orgSlug}
          orgName={orgName}
          permissions={permissions}
          onNavigate={() => {
            setAdminMobileNavOpen(false);
          }}
        />
      </aside>
    </div>
  );
}
