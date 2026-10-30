import type { ReactNode } from 'react';

import { cn } from '../../lib/cn';
import { EmptyState } from '../ui/Card';

export type UxEmptyReason = 'no_data' | 'filtered' | 'permission_limited';

export interface UxEmptyStateProps {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: { label: string; onClick: () => void };
  reason?: UxEmptyReason;
  className?: string;
}

export function UxEmptyState({
  title,
  description,
  icon,
  action,
  reason,
  className,
}: UxEmptyStateProps) {
  return (
    <div className={cn(className)} {...(reason ? { 'data-ux-empty-reason': reason } : {})}>
      <EmptyState
        title={title}
        {...(description ? { description } : {})}
        {...(icon ? { icon } : {})}
        {...(action ? { action } : {})}
      />
    </div>
  );
}
