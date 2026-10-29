import { Button } from './Button';
import { Skeleton } from './Card';
import { ApiError } from '../../lib/api/errors';

export function LoadingState({ label }: { label: string }) {
  return (
    <div role="status" aria-live="polite" aria-label={`${label}…`} className="space-y-3">
      <span className="sr-only">{label}…</span>
      <Skeleton className="h-7 w-48" />
      <Skeleton className="h-4 w-full max-w-md" />
      <Skeleton className="h-4 w-3/4 max-w-sm" />
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const requestId = error instanceof ApiError ? error.requestId : null;
  return (
    <div
      role="alert"
      className="space-y-3 rounded-lg border border-danger/30 bg-danger/10 p-4 text-fg"
    >
      <p className="font-medium text-danger">Something went wrong. Please try again.</p>
      {requestId ? (
        <p className="text-sm text-fg-muted">
          Reference:{' '}
          <code className="rounded bg-surface px-1 py-0.5 font-mono text-xs">{requestId}</code>
        </p>
      ) : null}
      {onRetry ? (
        <Button type="button" variant="secondary" size="sm" onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </div>
  );
}

/** Grid placeholder while project cards load. */
export function ProjectGridSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading projects…"
      className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
    >
      <span className="sr-only">Loading projects…</span>
      {[1, 2, 3].map((i) => (
        <div key={i} className="space-y-3 rounded-lg border border-line p-4">
          <Skeleton className="h-10 w-10 rounded-md" />
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-4 w-full" />
        </div>
      ))}
    </div>
  );
}
