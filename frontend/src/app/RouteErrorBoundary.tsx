import { isRouteErrorResponse, Link, useRouteError } from 'react-router';

import { ApiError } from '../lib/api/errors';

import { NotFoundPage } from './pages/NotFoundPage';

/** Route-level error UI. Never renders raw error messages or stack traces. */
export function RouteErrorBoundary() {
  const error = useRouteError();

  if (isRouteErrorResponse(error) && error.status === 404) return <NotFoundPage />;
  if (error instanceof ApiError && error.status === 404) return <NotFoundPage />;

  const requestId = error instanceof ApiError ? error.requestId : null;
  return (
    <section role="alert" aria-labelledby="error-title" className="space-y-3 p-8">
      <h1 id="error-title" className="text-2xl font-semibold">
        Something went wrong
      </h1>
      <p className="text-slate-600">An unexpected error occurred. Please try again.</p>
      {requestId ? (
        <p className="text-sm text-slate-500">
          Reference: <code>{requestId}</code>
        </p>
      ) : null}
      <Link to="/" className="text-blue-700 underline underline-offset-2">
        Go to the home page
      </Link>
    </section>
  );
}
