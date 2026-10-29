import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { json, mockApi, renderApp, SIGNED_IN } from '../../test/api';

const SESSION = {
  ...SIGNED_IN,
  user: { ...SIGNED_IN.user, email_verified: true },
  orgs: [{ slug: 'acme', name: 'Acme', role: 'member' }],
};
const ITEMS = [
  {
    id: 'n1',
    type: 'issue_status_changed',
    issue_key: 'WEB-1',
    actor: { id: 'u2', display_name: 'Bob' },
    payload: { summary: 'Login', from: 'To Do', to: 'Done' },
    read: false,
    created_at: '2026-10-30T00:00:00Z',
  },
  {
    id: 'n2',
    type: 'issue_assigned',
    issue_key: 'WEB-2',
    actor: { id: 'u2', display_name: 'Bob' },
    payload: { summary: 'Checkout' },
    read: true,
    created_at: '2026-10-29T00:00:00Z',
  },
];

function api(overrides: Record<string, () => Response> = {}) {
  return mockApi({
    'GET /auth/session': () => json(SESSION),
    'GET /orgs/acme': () =>
      json({
        id: '22222222-2222-2222-2222-222222222222',
        slug: 'acme',
        name: 'Acme',
        role: 'member',
        permissions: ['org.view'],
        created_at: '2026-10-27T00:00:00Z',
      }),
    'GET /orgs/acme/projects': () => json({ items: [], next_cursor: null }),
    'GET /orgs/acme/notifications/unread-count': () => json({ count: 1 }),
    'GET /orgs/acme/notifications': () => json({ items: ITEMS, next_cursor: null }),
    ...overrides,
  });
}

describe('notification bell', () => {
  it('shows the unread count and lists notifications', async () => {
    api();
    renderApp('/o/acme');
    const bell = await screen.findByRole('button', { name: /Notifications/ });
    expect(await within(bell).findByText('1 unread')).toBeInTheDocument();
    await userEvent.click(bell);
    expect(await screen.findByText('Bob moved WEB-1 from To Do to Done')).toBeInTheDocument();
    expect(screen.getByText('Bob assigned you WEB-2')).toBeInTheDocument();
  });

  it('marks one notification read when it is opened and all read on request', async () => {
    const calls = api({
      'POST /orgs/acme/notifications/n1/read': () => new Response(null, { status: 204 }),
      'POST /orgs/acme/notifications/read-all': () => json({ updated: 1 }),
    });
    renderApp('/o/acme');
    await userEvent.click(await screen.findByRole('button', { name: /Notifications/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Mark all read' }));
    await waitFor(() => {
      expect(calls.some((c) => c.path.endsWith('/read-all') && c.method === 'POST')).toBe(true);
    });
  });
});
