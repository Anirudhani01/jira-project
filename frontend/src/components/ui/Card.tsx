import type { HTMLAttributes, ReactNode } from 'react';

import { cn } from '../../lib/cn';
import { Button } from './Button';

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('rounded-lg border border-line bg-surface shadow-sm', className)}
      {...props}
    />
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={cn('animate-pulse rounded-md bg-surface-2', className)} />
  );
}

/** Explains an empty screen and offers the next step. */
export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-line-strong px-6 py-10 text-center">
      {icon ? <div className="text-fg-subtle">{icon}</div> : null}
      <h2 className="text-base font-semibold">{title}</h2>
      {description ? <p className="max-w-sm text-sm text-fg-muted">{description}</p> : null}
      {action ? (
        <Button variant="primary" onClick={action.onClick} className="mt-2">
          {action.label}
        </Button>
      ) : null}
    </div>
  );
}
