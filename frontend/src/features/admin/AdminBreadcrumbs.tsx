import { Fragment } from 'react';
import { Link, useLocation } from 'react-router';

import { adminBreadcrumbLabel, adminBreadcrumbTrail } from './adminNav';

function CrumbSeparator() {
  return (
    <li aria-hidden="true" className="text-[var(--admin-border)]">
      /
    </li>
  );
}

export function AdminBreadcrumbs({ orgSlug, orgName }: { orgSlug: string; orgName: string }) {
  const { pathname } = useLocation();
  const nested = adminBreadcrumbTrail(pathname, orgSlug);
  const page =
    nested.length > 1 ? nested[nested.length - 1]?.label : adminBreadcrumbLabel(pathname, orgSlug);
  const middle = nested.length > 1 ? nested.slice(0, -1) : [];

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
        <CrumbSeparator />
        <li>
          <Link
            to={`/o/${orgSlug}/admin`}
            className="no-underline hover:text-[var(--admin-text)] hover:underline"
          >
            Administration
          </Link>
        </li>
        {middle.map((segment) => (
          <Fragment key={segment.label}>
            <CrumbSeparator />
            <li className="text-[var(--admin-muted)]">{segment.label}</li>
          </Fragment>
        ))}
        <CrumbSeparator />
        <li aria-current="page" className="font-medium text-[var(--admin-text)]">
          {page}
        </li>
      </ol>
    </nav>
  );
}
