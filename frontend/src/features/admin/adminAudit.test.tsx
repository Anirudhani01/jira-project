import { screen } from '@testing-library/react';

import { json, mockApi, renderApp, SIGNED_IN } from '../../test/api';

const SESSION = {
  ...SIGNED_IN,
  user: { ...SIGNED_IN.user, email_verified: true },
  orgs: [{ slug: 'acme', name: 'Acme', role: 'owner' }],
};
const ORG_OWNER = {
  id: '22222222-2222-2222-2222-222222222222',
  slug: 'acme',
  name: 'Acme',
  role: 'owner',
  permissions: ['org.view', 'org.manage', 'org.audit.view'],
  created_at: '2026-10-27T00:00:00Z',
};
const SHELL = {
  'GET /orgs/acme/notifications/unread-count': () => json({ count: 0 }),
  'GET /orgs/acme/members': () => json({ items: [] }),
  'GET /orgs/acme/audit-events': () => json({ items: [], next_cursor: null }),
};

describe('Admin Audit Logs', () => {
  it('owner sees audit logs on the canonical admin route', async () => {
    mockApi({
      'GET /auth/session': () => json(SESSION),
      'GET /orgs/acme': () => json(ORG_OWNER),
      ...SHELL,
    });
    renderApp('/o/acme/admin/audit');
    expect(
      await screen.findByRole('heading', { name: 'Audit Logs', level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Administration' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Filters' })).toBeInTheDocument();
  });

  it('member without audit permission is denied and does not fetch audit events', async () => {
    const calls = mockApi({
      'GET /auth/session': () => json(SESSION),
      'GET /orgs/acme': () => json({ ...ORG_OWNER, role: 'member', permissions: ['org.view'] }),
      ...SHELL,
    });
    renderApp('/o/acme/admin/audit');
    expect(await screen.findByRole('region', { name: /don't have access/i })).toBeInTheDocument();
    expect(calls.some((c) => c.path.includes('/audit-events'))).toBe(false);
    expect(calls.some((c) => c.path.includes('/members'))).toBe(false);
  });
});
