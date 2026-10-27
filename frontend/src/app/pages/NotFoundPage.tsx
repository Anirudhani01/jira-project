import { Link } from 'react-router';

export function NotFoundPage() {
  return (
    <section aria-labelledby="not-found-title" className="space-y-3">
      <h1 id="not-found-title" className="text-2xl font-semibold">
        Page not found
      </h1>
      <p className="text-slate-600">
        The page you are looking for does not exist or you do not have access to it.
      </p>
      <Link to="/" className="text-blue-700 underline underline-offset-2">
        Go to the home page
      </Link>
    </section>
  );
}
