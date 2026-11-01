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
  'GET /orgs/acme/authentication-activity': () => json({ items: [], next_cursor: null }),
};

describe('Admin Authentication Activity navigation', () => {
  it('shows Authentication Activity under Security for owners with audit access', async () => {
    mockApi({
      'GET /auth/session': () => json(SESSION),
      'GET /orgs/acme': () => json(ORG_OWNER),
      ...SHELL,
    });
    renderApp('/o/acme/admin/security/activity');
    expect(
      await screen.findByRole('heading', { name: 'Authentication Activity', level: 1 }),
    ).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Administration' });
    expect(nav).toHaveTextContent('Audit Logs');
    expect(nav).toHaveTextContent('Authentication Activity');
  });

  it('hides security audit links from members without org.audit.view', async () => {
    mockApi({
      'GET /auth/session': () => json(SESSION),
      'GET /orgs/acme': () => json({ ...ORG_OWNER, role: 'member', permissions: ['org.view'] }),
      'GET /orgs/acme/notifications/unread-count': () => json({ count: 0 }),
    });
    renderApp('/o/acme/admin');
    await screen.findByRole('heading', { name: 'Administration overview', level: 1 });
    const nav = screen.getByRole('navigation', { name: 'Administration' });
    expect(nav).not.toHaveTextContent('Audit Logs');
    expect(nav).not.toHaveTextContent('Authentication Activity');
  });
});
