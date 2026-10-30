import { Link } from 'react-router';

import { cn } from '../../lib/cn';
import { Button } from '../ui/Button';

export interface UxPermissionDeniedProps {
  capability: string;
  reason?: string;
  backAction: { label: string; href: string } | { label: string; onClick: () => void };
  contactAdmin?: { label: string; href: string };
  className?: string;
}

export function UxPermissionDenied({
  capability,
  reason,
  backAction,
  contactAdmin,
  className,
}: UxPermissionDeniedProps) {
  const titleId = 'ux-permission-denied-title';

  return (
    <section
      role="region"
      aria-labelledby={titleId}
      className={cn('space-y-4 rounded-lg border border-line bg-surface-2 px-6 py-8', className)}
    >
      <h2 id={titleId} className="text-lg font-semibold text-fg">
        You don&apos;t have access to {capability}
      </h2>
      {reason ? <p className="max-w-prose text-sm text-fg-muted">{reason}</p> : null}
      <div className="flex flex-wrap gap-3">
        {'href' in backAction ? (
          <Button asChild variant="secondary" size="sm">
            <Link to={backAction.href}>{backAction.label}</Link>
          </Button>
        ) : (
          <Button type="button" variant="secondary" size="sm" onClick={backAction.onClick}>
            {backAction.label}
          </Button>
        )}
        {contactAdmin ? (
          <Button asChild variant="ghost" size="sm">
            <Link to={contactAdmin.href}>{contactAdmin.label}</Link>
          </Button>
        ) : null}
      </div>
    </section>
  );
}
