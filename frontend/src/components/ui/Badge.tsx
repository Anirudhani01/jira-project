import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes } from 'react';

import { cn } from '../../lib/cn';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-sm px-1.5 text-[11px] font-semibold uppercase tracking-wide leading-5',
  {
    variants: {
      tone: {
        neutral: 'bg-surface-2 text-fg-muted',
        info: 'bg-info-soft text-info',
        success: 'bg-success-soft text-success',
        warning: 'bg-warning-soft text-warning',
        danger: 'bg-danger-soft text-danger',
        accent: 'bg-accent-soft text-accent',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export function Badge({
  className,
  tone,
  ...props
}: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

/** Count bubble used in column headers and sidebars. */
export function Count({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'rounded-full bg-surface-2 px-1.5 text-xs font-medium text-fg-muted',
        className,
      )}
    >
      {children}
    </span>
  );
}
