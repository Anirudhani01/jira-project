import { Link } from 'react-router';

import { Button } from '../../../components/ui/Button';

import { OrgPromoBoardIllustration } from './OrgPromoBoardIllustration';

export function OrgPromoBanner({
  orgSlug,
  canCreateProject,
}: {
  orgSlug: string;
  canCreateProject: boolean;
}) {
  return (
    <section
      aria-labelledby="org-promo-title"
      className="org-dash-promo overflow-hidden rounded-xl border p-6 sm:p-8"
    >
      <div className="flex flex-col items-start justify-between gap-6 sm:flex-row sm:items-center">
        <div className="max-w-xl space-y-3">
          <p className="org-dash-on-accent-soft text-xs font-semibold uppercase tracking-[0.16em]">
            Work together
          </p>
          <h2 id="org-promo-title" className="text-xl font-bold text-[var(--org-dash-text)]">
            Plan, track, and ship great work
          </h2>
          <p className="org-dash-promo-muted text-sm leading-relaxed">
            Use boards, issues, and reports to keep your team aligned and productive.
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            {canCreateProject ? (
              <Button variant="primary" size="sm" className="org-dash-btn-primary" asChild>
                <Link to={`/o/${orgSlug}/projects/new`}>Create project</Link>
              </Button>
            ) : null}
            <span className="org-dash-promo-muted inline-flex h-8 items-center text-sm font-medium">
              Learn more — coming soon
            </span>
          </div>
        </div>
        <OrgPromoBoardIllustration />
      </div>
    </section>
  );
}
