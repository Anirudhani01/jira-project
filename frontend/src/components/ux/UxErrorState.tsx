import { cn } from '../../lib/cn';
import {
  genericUxErrorPresentation,
  mapApiErrorToUxState,
} from '../../lib/ux/mapApiErrorToUxState';
import type { MapApiErrorContext, UxErrorPresentation } from '../../lib/ux/types';
import { Button } from '../ui/Button';

export interface UxErrorStateProps {
  error?: unknown;
  presentation?: UxErrorPresentation;
  context?: MapApiErrorContext;
  onRetry?: () => void;
  variant?: 'default' | 'compact';
  className?: string;
}

export function UxErrorState({
  error,
  presentation,
  context,
  onRetry,
  variant = 'default',
  className,
}: UxErrorStateProps) {
  const resolved =
    presentation !== undefined
      ? presentation
      : error !== undefined
        ? mapApiErrorToUxState(error, context)
        : genericUxErrorPresentation;

  const showRetry = resolved.retryable && onRetry !== undefined;

  return (
    <div
      role="alert"
      className={cn(
        'space-y-3 rounded-lg border border-danger/30 bg-danger/10 text-fg',
        variant === 'compact' ? 'p-3' : 'p-4',
        className,
      )}
    >
      <p className="font-medium text-danger">{resolved.title}</p>
      <p className={cn('text-fg', variant === 'compact' ? 'text-sm' : 'text-sm')}>
        {resolved.description}
      </p>
      {resolved.recoveryHint ? (
        <p className="text-sm text-fg-muted">{resolved.recoveryHint}</p>
      ) : null}
      {resolved.showRequestId && resolved.requestId ? (
        <p className="text-sm text-fg-muted">
          Reference:{' '}
          <code className="rounded bg-surface px-1 py-0.5 font-mono text-xs">
            {resolved.requestId}
          </code>
        </p>
      ) : null}
      {showRetry ? (
        <Button type="button" variant="secondary" size="sm" onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </div>
  );
}
