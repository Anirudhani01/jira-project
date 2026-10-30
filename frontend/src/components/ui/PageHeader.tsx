import type { ReactNode } from 'react';

import { cn } from '../../lib/cn';

export function PageHeader({
  title,
  titleId,
  description,
  actions,
  className,
}: {
  title: string;
  titleId?: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-4', className)}>
      <div className="min-w-0 space-y-1">
        <h1 id={titleId} className="text-2xl font-semibold text-fg">
          {title}
        </h1>
        {description ? <p className="text-sm text-fg-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
