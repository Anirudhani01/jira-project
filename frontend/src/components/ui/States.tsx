import { ApiError } from '../../lib/api/errors';

export function LoadingState({ label }: { label: string }) {
  return (
    <p role="status" aria-live="polite" className="text-slate-600">
      {label}…
    </p>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const requestId = error instanceof ApiError ? error.requestId : null;
  return (
    <div role="alert" className="space-y-2 rounded border border-red-200 bg-red-50 p-4">
      <p className="font-medium text-red-800">Something went wrong. Please try again.</p>
      {requestId ? (
        <p className="text-sm text-red-700">
          Reference: <code>{requestId}</code>
        </p>
      ) : null}
      {onRetry ? (
        <button type="button" onClick={onRetry} className="text-sm text-red-800 underline">
          Retry
        </button>
      ) : null}
    </div>
  );
}
