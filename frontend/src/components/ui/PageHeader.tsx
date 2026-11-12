import { useContext, type ReactNode } from 'react';

import { cn } from '../../lib/cn';

import { PageHeaderLevelContext } from './pageHeaderLevel';

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
  const level = useContext(PageHeaderLevelContext);
  const Heading = level === 2 ? 'h2' : 'h1';
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-4', className)}>
      <div className="min-w-0 space-y-1">
        <Heading
          id={titleId}
          className={cn('font-medium text-fg', level === 2 ? 'text-xl' : 'text-2xl')}
        >
          {title}
        </Heading>
        {description ? <p className="text-sm text-fg-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
