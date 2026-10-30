import { Link, useLocation } from 'react-router';

import { useSession } from '../../features/auth/api';
import { useProject } from '../../features/projects/api';

import { useProjectContext } from './useProjectContext';

function segmentLabel(pathname: string, projectKey: string): string | null {
  if (pathname.endsWith('/board')) return 'Board';
  if (pathname.endsWith('/backlog')) return 'Backlog';
  if (pathname.endsWith('/issues')) return 'Issues';
  if (pathname.match(new RegExp(`/p/${projectKey}/?$`, 'i'))) return 'Settings';
  return null;
}

export function Breadcrumbs() {
  const location = useLocation();
  const session = useSession();
  const ctx = useProjectContext();
  const projectKey = ctx?.projectKey ?? '';
  const project = useProject(ctx?.org ?? '', projectKey);
  const showProject = ctx?.projectKey != null;

  if (!session.data || !ctx?.org) return null;

  const org = session.data.orgs.find((o) => o.slug.toLowerCase() === ctx.org.toLowerCase());
  const orgName = org?.name ?? ctx.org;
  const page = showProject ? segmentLabel(location.pathname, projectKey) : null;

  return (
    <nav
      aria-label="Breadcrumb"
      className="border-b border-line bg-surface px-4 py-2.5 text-sm sm:px-6 lg:px-8"
    >
      <ol className="flex flex-wrap items-center gap-1 text-fg-muted">
        <li>
          <Link to={`/o/${ctx.org}`} className="hover:text-fg hover:underline">
            {orgName}
          </Link>
        </li>
        {showProject ? (
          <>
            <li aria-hidden="true">/</li>
            <li>
              <Link to={`/o/${ctx.org}/p/${projectKey}`} className="hover:text-fg hover:underline">
                {project.data?.name ?? projectKey}
              </Link>
            </li>
          </>
        ) : null}
        {page ? (
          <>
            <li aria-hidden="true">/</li>
            <li aria-current="page" className="font-medium text-fg">
              {page}
            </li>
          </>
        ) : null}
      </ol>
    </nav>
  );
}
