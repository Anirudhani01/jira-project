import { Skeleton } from '../../components/ui/Card';

export function BoardSkeleton() {
  return (
    <div role="status" aria-label="Loading board…" className="space-y-4">
      <span className="sr-only">Loading board…</span>
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-12 w-full max-w-3xl" />
      <div className="flex gap-3 overflow-x-auto pb-2">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="flex w-[17.5rem] shrink-0 flex-col gap-2 rounded-lg border border-line bg-surface-2/50 p-3"
          >
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-1.5 w-full" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
