import { Link } from 'react-router';

import { useRecents } from '../../../app/shell/navPrefs';
import { Card } from '../../../components/ui/Card';
import { useProjects } from '../../projects/api';

import { boardTypeLabel } from './ProjectDashboardCard';

const LIMIT = 5;

/** Issues the user opened lately (kept in this browser), with the project they belong to. */
export function OrgRecentlyOpenedCard({ orgSlug }: { orgSlug: string }) {
  const { recent } = useRecents(orgSlug);
  const projects = useProjects(orgSlug);
  const issues = recent.filter((item) => item.kind === 'issue').slice(0, LIMIT);

  return (
    <section aria-labelledby="recently-opened-title" className="space-y-3">
      <h2
        id="recently-opened-title"
        className="text-base font-semibold text-[var(--org-dash-text)]"
      >
        Recently opened
      </h2>
      {issues.length === 0 ? (
        <p className="text-sm text-[var(--org-dash-muted)]">Issues you open appear here.</p>
      ) : (
        <Card className="org-dash-card overflow-hidden">
          <ul className="divide-y divide-[var(--org-dash-border)]">
            {issues.map((issue) => {
              const project = projects.data?.find((p) => issue.key.startsWith(`${p.key}-`));
              return (
                <li key={issue.key}>
                  <Link
                    to={`/o/${orgSlug}/issues/${issue.key}`}
                    className="flex items-center gap-4 px-5 py-3 text-sm no-underline hover:bg-surface-hover focus-visible:bg-surface-hover"
                  >
                    <span className="w-24 shrink-0 font-mono text-[13px] text-[var(--org-dash-link)]">
                      {issue.key}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[var(--org-dash-text)]">
                      {project?.name ?? ''}
                    </span>
                    <span className="shrink-0 text-[13px] text-[var(--org-dash-muted)]">
                      {project ? boardTypeLabel(project.board_type) : ''}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </section>
  );
}
