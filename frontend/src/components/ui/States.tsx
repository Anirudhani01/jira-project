import { UxErrorState } from '../ux/UxErrorState';

import { Skeleton } from './Card';

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
  return (
    <UxErrorState
      error={error}
      {...(onRetry ? { onRetry } : {})}
      context={{ hadEstablishedSession: false, surface: 'default' }}
    />
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
