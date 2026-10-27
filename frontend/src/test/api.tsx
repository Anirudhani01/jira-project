import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';

import { AppProviders } from '../app/providers';
import { routes } from '../app/routes';
import { setCsrfToken } from '../lib/api/client';
import { createQueryClient } from '../lib/queryClient';

export interface MockCall {
  method: string;
  path: string;
  headers: Headers;
  body: unknown;
}

type Handler = (call: MockCall) => Response | Promise<Response>;

export const json = (body: unknown, status = 200) => Response.json(body, { status });
export const problem = (status: number, code: string, extra: Record<string, unknown> = {}) =>
  Response.json({ status, code, title: code, request_id: 'req-test', ...extra }, { status });

export const SIGNED_IN = {
  user: {
    id: '11111111-1111-1111-1111-111111111111',
    email: 'ann@example.com',
    display_name: 'Ann Example',
    email_verified: false,
  },
  csrf_token: 'csrf-abc',
  session: { id: 's1', expires_at: '2030-01-01T00:00:00Z' },
  orgs: [] as { slug: string; name: string; role: string }[],
};

/** Route fetch calls by "METHOD /path" (path relative to /api/v1). Records every call. */
export function mockApi(handlers: Record<string, Handler>): MockCall[] {
  const calls: MockCall[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const raw = input instanceof Request ? input.url : input.toString();
      const url = new URL(raw, 'https://app.test');
      const method = (init?.method ?? 'GET').toUpperCase();
      const path = url.pathname.replace(/^\/api\/v1/, '');
      const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      const call = { method, path, headers: new Headers(init?.headers), body };
      calls.push(call);
      const handler = handlers[`${method} ${path}`];
      return handler ? handler(call) : problem(404, 'not_found');
    }),
  );
  return calls;
}

export function renderApp(path: string) {
  setCsrfToken(null);
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const view = render(
    <AppProviders client={createQueryClient()}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return { router, ...view };
}
