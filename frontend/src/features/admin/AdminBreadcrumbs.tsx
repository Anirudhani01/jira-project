import { Link, useLocation } from 'react-router';

import { adminBreadcrumbLabel } from './adminNav';

export function AdminBreadcrumbs({ orgSlug, orgName }: { orgSlug: string; orgName: string }) {
  const { pathname } = useLocation();
  const page = adminBreadcrumbLabel(pathname, orgSlug);

  return (
    <nav
      aria-label="Breadcrumb"
      className="border-b border-[var(--admin-border)] bg-[var(--admin-surface)] px-4 py-2.5 text-sm sm:px-6"
    >
      <ol className="flex flex-wrap items-center gap-1.5 text-[var(--admin-muted)]">
        <li>
          <Link
            to={`/o/${orgSlug}`}
            className="font-medium text-[var(--admin-muted)] no-underline hover:text-[var(--admin-text)] hover:underline"
          >
            {orgName}
          </Link>
        </li>
        <li aria-hidden="true" className="text-[var(--admin-border)]">
          /
        </li>
        <li>
          <Link
            to={`/o/${orgSlug}/admin`}
            className="no-underline hover:text-[var(--admin-text)] hover:underline"
          >
            Administration
          </Link>
        </li>
        <li aria-hidden="true" className="text-[var(--admin-border)]">
          /
        </li>
        <li aria-current="page" className="font-medium text-[var(--admin-text)]">
          {page}
        </li>
      </ol>
    </nav>
  );
}
