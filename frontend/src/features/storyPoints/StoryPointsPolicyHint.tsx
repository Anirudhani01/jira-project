import { Link } from 'react-router';

import { estimatesSettingsHref } from './storyPointsIssueUx';

export function StoryPointsConflictBanner({
  org,
  projectKey,
  className,
}: {
  org: string;
  projectKey: string;
  className?: string;
}) {
  const estimates = estimatesSettingsHref(org, projectKey);
  return (
    <div
      role="status"
      className={
        className ??
        'rounded-lg border border-warning/50 bg-warning-soft px-3 py-2 text-sm text-fg-muted'
      }
    >
      Project estimate overrides conflict with organization settings. Story point changes may be
      blocked until an admin resolves overrides on the{' '}
      <Link to={estimates} className="text-accent underline-offset-2 hover:underline">
        Estimates
      </Link>{' '}
      tab. Clearing an estimate may still work.
    </div>
  );
}

export function StoryPointsDisabledHint({ className }: { className?: string }) {
  return (
    <p className={className ?? 'text-xs text-fg-muted'}>
      Story points are not enabled for this project under current settings.
    </p>
  );
}
