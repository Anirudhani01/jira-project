import { NavLink } from 'react-router';

import { cn } from '../../../lib/cn';

const TAB_CLASS = ({ isActive }: { isActive: boolean }) =>
  cn(
    'inline-flex items-center border-b-2 px-1 pb-3 pt-1 text-sm font-medium no-underline transition-colors',
    isActive
      ? 'org-dash-link border-[var(--org-dash-accent)]'
      : 'border-transparent text-[var(--org-dash-muted)] hover:border-[var(--org-dash-border)] hover:text-[var(--org-dash-text)]',
  );

export function OrgDashboardTabs({
  orgSlug,
  showAudit,
}: {
  orgSlug: string;
  showAudit: boolean;
}) {
  return (
    <nav
      aria-label="Organization sections"
      className="-mx-1 overflow-x-auto border-b border-[var(--org-dash-border)] px-1"
    >
      <div className="-mb-px flex min-w-min gap-5 sm:gap-6">
        <NavLink to={`/o/${orgSlug}`} end className={TAB_CLASS}>
          Projects
        </NavLink>
        <NavLink to={`/o/${orgSlug}/settings/members`} className={TAB_CLASS}>
          Members
        </NavLink>
        {showAudit ? (
          <NavLink to={`/o/${orgSlug}/settings/audit`} className={TAB_CLASS}>
            Audit log
          </NavLink>
        ) : null}
        <NavLink to={`/o/${orgSlug}/settings`} className={TAB_CLASS}>
          Settings
        </NavLink>
      </div>
    </nav>
  );
}
