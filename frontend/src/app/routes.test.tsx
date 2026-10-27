import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router';

import { createQueryClient } from '../lib/queryClient';
import { ApiError } from '../lib/api/errors';

import { AppShell } from './AppShell';
import { AppProviders } from './providers';
import { RouteErrorBoundary } from './RouteErrorBoundary';
import { routes } from './routes';

function renderAt(path: string, routeObjects: RouteObject[] = routes) {
  const router = createMemoryRouter(routeObjects, { initialEntries: [path] });
  return render(
    <AppProviders client={createQueryClient()}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
}

describe('application routes', () => {
  it('renders the shell and home page at /', () => {
    renderAt('/');
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Welcome' })).toBeInTheDocument();
    expect(screen.getByRole('main')).toBeInTheDocument();
  });

  it('renders the not-found page for unknown routes inside the shell', () => {
    renderAt('/definitely/not/a/page');
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeInTheDocument();
  });

  it('renders a safe error boundary without leaking error details', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    function Broken(): never {
      throw new ApiError({
        status: 500,
        code: 'internal_error',
        title: 'Internal server error',
        detail: 'secret internals',
        requestId: 'req-789',
      });
    }
    renderAt('/', [
      {
        path: '/',
        element: <AppShell />,
        errorElement: <RouteErrorBoundary />,
        children: [{ index: true, element: <Broken /> }],
      },
    ]);
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
    expect(screen.getByText('req-789')).toBeInTheDocument();
    expect(screen.queryByText(/secret internals/)).not.toBeInTheDocument();
  });
});
