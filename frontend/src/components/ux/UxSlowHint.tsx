import { Loader2 } from 'lucide-react';

import { cn } from '../../lib/cn';

export interface UxSlowHintProps {
  visible: boolean;
  stage?: string;
  className?: string;
}

export function UxSlowHint({ visible, stage = 'Still working…', className }: UxSlowHintProps) {
  if (!visible) return null;

  return (
    <p
      role="status"
      aria-live="polite"
      className={cn('inline-flex items-center gap-2 text-sm text-fg-muted', className)}
    >
      <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden="true" />
      {stage}
    </p>
  );
}
