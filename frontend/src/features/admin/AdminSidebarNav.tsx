import { NavLink } from 'react-router';

import { cn } from '../../lib/cn';

import {
  adminBackToWorkspace,
  filterAdminNavGroups,
  adminNavGroups,
  type AdminNavItem,
} from './adminNav';

function linkClass(isActive: boolean) {
  return cn(
    'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm no-underline outline-none transition-colors',
    'text-[var(--admin-muted)] hover:bg-[var(--admin-accent-soft)] hover:text-[var(--admin-text)]',
    'focus-visible:ring-2 focus-visible:ring-[var(--admin-accent)] focus-visible:ring-offset-1',
    isActive &&
      'bg-[var(--admin-accent-soft)] font-medium text-[var(--admin-accent-on-soft)] hover:text-[var(--admin-accent-on-soft)]',
  );
}

function NavItemLink({ item, onNavigate }: { item: AdminNavItem; onNavigate?: () => void }) {
  const Icon = item.icon;
  const hash = item.to.includes('#') ? item.to.split('#')[1] : undefined;
  const pathname = item.to.split('#')[0] ?? item.to;
  return (
    <NavLink
      to={hash ? { pathname, hash: `#${hash}` } : pathname}
      end={item.id === 'overview'}
      className={({ isActive }) => linkClass(isActive)}
      onClick={onNavigate}
    >
      <Icon className="size-4 shrink-0 opacity-80" aria-hidden />
      <span>{item.label}</span>
    </NavLink>
  );
}

export function AdminSidebarNav({
  orgSlug,
  orgName,
  permissions,
  onNavigate,
}: {
  orgSlug: string;
  orgName: string;
  permissions: string[];
  onNavigate?: () => void;
}) {
  const back = adminBackToWorkspace(orgSlug);
  const BackIcon = back.icon;
  const groups = filterAdminNavGroups(adminNavGroups(orgSlug), permissions);

  return (
    <div className="flex h-full flex-col gap-5 p-3">
      <div className="space-y-1 border-b border-[var(--admin-border)] pb-4">
        <p className="px-2.5 text-xs font-semibold uppercase tracking-wide text-[var(--admin-muted)]">
          Administration
        </p>
        <p className="truncate px-2.5 text-sm font-medium text-[var(--admin-text)]">{orgName}</p>
        <NavLink
          to={back.to}
          className={cn(
            linkClass(false),
            'mt-2 font-medium text-[var(--admin-accent-on-soft)] hover:text-[var(--admin-accent-hover)]',
          )}
          onClick={onNavigate}
        >
          <BackIcon className="size-4 shrink-0" aria-hidden />
          <span>{back.label}</span>
        </NavLink>
      </div>
      <nav aria-label="Administration" className="flex flex-1 flex-col gap-5 overflow-y-auto">
        {groups.map((group) => (
          <div key={group.id}>
            <p className="mb-1.5 px-2.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--admin-muted)]">
              {group.label}
            </p>
            <div className="flex flex-col gap-0.5">
              {group.items.map((item) => (
                <NavItemLink
                  key={item.id}
                  item={item}
                  {...(onNavigate ? { onNavigate } : {})}
                />
              ))}
            </div>
          </div>
        ))}
      </nav>
    </div>
  );
}
