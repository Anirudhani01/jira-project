import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { json, mockApi, problem, renderApp, SIGNED_IN } from '../../test/api';

const SESSION = {
  ...SIGNED_IN,
  user: { ...SIGNED_IN.user, email_verified: true },
  orgs: [{ slug: 'acme', name: 'Acme', role: 'owner' }],
};
const ORG = {
  id: '22222222-2222-2222-2222-222222222222',
  slug: 'acme',
  name: 'Acme',
  role: 'owner',
  permissions: ['org.audit.view', 'org.view'],
  created_at: '2026-10-27T00:00:00Z',
};
const EVENT = {
  id: 1,
  action: 'project.created',
  actor_user_id: 'u1',
  outcome: 'success',
  target_type: 'project',
  target_id: 'p1',
  ip: null,
  request_id: null,
  metadata: { project: 'WEB' },
  created_at: '2026-10-30T10:00:00Z',
};

describe('audit log', () => {
  it('lists events and sends the action filter', async () => {
    const calls = mockApi({
      'GET /auth/session': () => json(SESSION),
      'GET /orgs/acme': () => json(ORG),
      'GET /orgs/acme/audit-events': () => json({ items: [EVENT], next_cursor: null }),
    });
    renderApp('/o/acme/settings/audit');
    expect(await screen.findByText('project.created')).toBeInTheDocument();
    expect(screen.getByText('project=WEB')).toBeInTheDocument();
    const filter = screen.getByLabelText('Action');
    await userEvent.type(filter, 'project.created');
    await userEvent.tab();
    await waitFor(() => {
      expect(calls.some((c) => c.search.includes('action=project.created'))).toBe(true);
    });
  });

  it('shows permission denied when the audit query returns forbidden', async () => {
    mockApi({
      'GET /auth/session': () => json(SESSION),
      'GET /orgs/acme': () => json(ORG),
      'GET /orgs/acme/audit-events': () =>
        problem(403, 'forbidden', { detail: 'must not appear in UI' }),
    });
    renderApp('/o/acme/settings/audit');
    expect(await screen.findByRole('region', { name: /don't have access/i })).toBeInTheDocument();
    expect(screen.queryByText('must not appear in UI')).not.toBeInTheDocument();
  });

  it('tells members without audit access that the log is restricted', async () => {
    const calls = mockApi({
      'GET /auth/session': () => json(SESSION),
      'GET /orgs/acme': () => json({ ...ORG, role: 'member', permissions: ['org.view'] }),
    });
    renderApp('/o/acme/settings/audit');
    expect(await screen.findByRole('region', { name: /don't have access/i })).toHaveTextContent(
      /owners and admins/,
    );
    expect(calls.some((c) => c.path.includes('/audit-events'))).toBe(false);
  });
});
