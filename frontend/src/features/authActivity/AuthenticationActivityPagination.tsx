import { Button } from '../../components/ui/Button';

import { AUTH_ACTIVITY_PAGE_SIZES } from './api';

/** Page controls under the activity table. The API gives no total, so there are no page
 * numbers or last-page jump: just the current range, Previous and Next. */
export function AuthenticationActivityPagination({
  pageIndex,
  pageSize,
  itemCount,
  hasPrevious,
  hasNext,
  loading,
  onPrevious,
  onNext,
  onPageSizeChange,
}: {
  pageIndex: number;
  pageSize: number;
  itemCount: number;
  hasPrevious: boolean;
  hasNext: boolean;
  loading: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onPageSizeChange: (size: number) => void;
}) {
  const first = pageIndex * pageSize + 1;
  const last = pageIndex * pageSize + itemCount;
  return (
    <nav
      aria-label="Pagination"
      className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-t border-[var(--admin-border)] pt-4 text-sm"
    >
      <label className="flex items-center gap-2 text-[var(--admin-muted)]">
        Rows per page
        <select
          className="h-8 rounded-md border border-control bg-surface px-2 text-sm text-fg"
          value={pageSize}
          onChange={(event) => {
            onPageSizeChange(Number(event.target.value));
          }}
        >
          {AUTH_ACTIVITY_PAGE_SIZES.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </label>
      <p className="tabular-nums text-[var(--admin-muted)]" role="status" aria-live="polite">
        Showing {first}–{last} · Page {pageIndex + 1}
      </p>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={!hasPrevious || loading}
          onClick={onPrevious}
        >
          Previous
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={!hasNext || loading}
          onClick={onNext}
        >
          Next
        </Button>
      </div>
    </nav>
  );
}
