import { screen } from '@testing-library/react';

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
  permissions: ['org.view', 'org.manage'],
  created_at: '2026-10-27T00:00:00Z',
};
const TASK = { id: 't-task', name: 'Task', kind: 'standard', position: 2 };
const BUG = { id: 't-bug', name: 'Bug', kind: 'standard', position: 3 };
const MEDIUM = { id: 'p-med', name: 'Medium', sort_order: 2, color: '#ca8a04' };
const HIGH = { id: 'p-high', name: 'High', sort_order: 1, color: '#ea580c' };
const SHELL = {
  'GET /orgs/acme/notifications/unread-count': () => json({ count: 0 }),
};

describe('AdminCatalogsPage', () => {
  it('lists issue types and priorities from the organization APIs', async () => {
    mockApi({
      'GET /auth/session': () => json(SESSION),
      'GET /orgs/acme': () => json(ORG),
      ...SHELL,
      'GET /orgs/acme/issue-types': () => json({ items: [TASK, BUG] }),
      'GET /orgs/acme/priorities': () => json({ items: [HIGH, MEDIUM] }),
    });
    renderApp('/o/acme/admin/catalogs');
    expect(await screen.findByRole('heading', { name: 'Defaults & catalogs' })).toBeInTheDocument();
    expect(screen.getByText('Read-only')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Issue types' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Priorities' })).toBeInTheDocument();
    expect(screen.getByText('Task')).toBeInTheDocument();
    expect(screen.getByText('Bug')).toBeInTheDocument();
    expect(screen.getByText('High')).toBeInTheDocument();
    expect(screen.getByText('Medium')).toBeInTheDocument();
    expect(screen.getByText('#ea580c')).toBeInTheDocument();
  });

  it('shows empty states when both catalogs return no items', async () => {
    mockApi({
      'GET /auth/session': () => json(SESSION),
      'GET /orgs/acme': () => json(ORG),
      ...SHELL,
      'GET /orgs/acme/issue-types': () => json({ items: [] }),
      'GET /orgs/acme/priorities': () => json({ items: [] }),
    });
    renderApp('/o/acme/admin/catalogs');
    expect(await screen.findByRole('heading', { name: 'No issue types' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'No priorities' })).toBeInTheDocument();
  });

  it('still shows priorities when issue types fail independently', async () => {
    mockApi({
      'GET /auth/session': () => json(SESSION),
      'GET /orgs/acme': () => json(ORG),
      ...SHELL,
      'GET /orgs/acme/issue-types': () => problem(500, 'internal_error'),
      'GET /orgs/acme/priorities': () => json({ items: [HIGH] }),
    });
    renderApp('/o/acme/admin/catalogs');
    expect(await screen.findByRole('heading', { name: 'Issue types' })).toBeInTheDocument();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('High')).toBeInTheDocument();
    expect(screen.queryByText('Task')).not.toBeInTheDocument();
  });
});
