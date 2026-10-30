import { cn } from '../../lib/cn';
import { Button } from '../ui/Button';

export interface UxSearchEmptySuggestion {
  label: string;
  onApply: () => void;
}

export interface UxSearchEmptyProps {
  query: string;
  scope?: string;
  filtersActive?: boolean;
  onClearFilters?: () => void;
  onClearQuery?: () => void;
  suggestion?: UxSearchEmptySuggestion;
  className?: string;
}

export function UxSearchEmpty({
  query,
  scope = 'results',
  filtersActive = false,
  onClearFilters,
  onClearQuery,
  suggestion,
  className,
}: UxSearchEmptyProps) {
  const trimmed = query.trim();
  const title =
    trimmed.length > 0 ? `No ${scope} for “${trimmed}”` : `No ${scope} match your filters`;

  return (
    <div
      className={cn(
        'flex flex-col items-center gap-3 rounded-lg border border-dashed border-line-strong px-6 py-10 text-center',
        className,
      )}
    >
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="max-w-sm text-sm text-fg-muted">
        Try a different search term or clear filters to see more {scope}.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {filtersActive && onClearFilters ? (
          <Button type="button" variant="secondary" size="sm" onClick={onClearFilters}>
            Clear filters
          </Button>
        ) : null}
        {onClearQuery ? (
          <Button type="button" variant="ghost" size="sm" onClick={onClearQuery}>
            Clear search
          </Button>
        ) : null}
        {suggestion ? (
          <Button
            type="button"
            variant="link"
            size="sm"
            onClick={suggestion.onApply}
            aria-label={`Did you mean "${suggestion.label.trim()}"?`}
          >
            Did you mean &ldquo;{suggestion.label.trim()}&rdquo;?
          </Button>
        ) : null}
      </div>
    </div>
  );
}
