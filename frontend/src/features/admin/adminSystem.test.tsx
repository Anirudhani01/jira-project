import { screen } from '@testing-library/react';

import { json, mockApi, problem, renderApp, SIGNED_IN } from '../../test/api';

const SESSION = {
  ...SIGNED_IN,
  user: { ...SIGNED_IN.user, email_verified: true },
  orgs: [{ slug: 'acme', name: 'Acme', role: 'owner' }],
};
const ORG_ADMIN = {
  id: '22222222-2222-2222-2222-222222222222',
  slug: 'acme',
  name: 'Acme',
  role: 'owner',
  permissions: ['org.view', 'org.manage', 'org.members.manage', 'org.audit.view'],
  created_at: '2026-10-27T00:00:00Z',
};
const ORG_MEMBER = {
  ...ORG_ADMIN,
  role: 'member',
  permissions: ['org.view'],
};
const SHELL = {
  'GET /orgs/acme/notifications/unread-count': () => json({ count: 0 }),
};

function expectNoConfigurationControls() {
  expect(screen.queryByRole('button', { name: /save/i })).toBeNull();
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(screen.queryByRole('switch')).toBeNull();
  expect(screen.queryByLabelText(/smtp/i)).toBeNull();
  expect(screen.queryByText(/mark all read/i)).toBeNull();
}

describe('AdminSystemNotificationsPage', () => {
  it('shows informational content for org owners and admins', async () => {
    const calls = mockApi({
      'GET /auth/session': () => json(SESSION),
      'GET /orgs/acme': () => json(ORG_ADMIN),
      ...SHELL,
    });
    renderApp('/o/acme/admin/system/notifications');
    expect(await screen.findByRole('heading', { name: 'Notifications' })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'In-app notifications are user-specific' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Organization-wide policies are not configurable' }),
    ).toBeInTheDocument();
    expectNoConfigurationControls();
    expect(
      calls.some((c) => c.path.includes('/notifications') && !c.path.includes('unread-count')),
    ).toBe(false);
  });

  it('denies members on direct URL access', async () => {
    mockApi({
      'GET /auth/session': () => json(SESSION),
      'GET /orgs/acme': () => json(ORG_MEMBER),
      ...SHELL,
    });
    renderApp('/o/acme/admin/system/notifications');
    expect(await screen.findByRole('region', { name: /don't have access/i })).toHaveTextContent(
      /don.t have permission to change/,
    );
    expect(
      screen.queryByRole('heading', { name: 'In-app notifications are user-specific' }),
    ).toBeNull();
  });

  it('shows loading then content when org is fetched', async () => {
    mockApi({
      'GET /auth/session': () => json(SESSION),
      'GET /orgs/acme': () => json(ORG_ADMIN),
      ...SHELL,
    });
    renderApp('/o/acme/admin/system/notifications');
    expect(await screen.findByRole('heading', { name: 'Notifications' })).toBeInTheDocument();
  });

  it('shows error state when organization load fails', async () => {
    mockApi({
      'GET /auth/session': () => json(SESSION),
      'GET /orgs/acme': () => problem(500, 'internal_error'),
      ...SHELL,
    });
    renderApp('/o/acme/admin/system/notifications');
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});

describe('AdminSystemEmailPage', () => {
  it('shows informational content for org owners and admins', async () => {
    mockApi({
      'GET /auth/session': () => json(SESSION),
      'GET /orgs/acme': () => json(ORG_ADMIN),
      ...SHELL,
    });
    renderApp('/o/acme/admin/system/email');
    expect(await screen.findByRole('heading', { name: 'Email delivery' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Transactional outbox' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'What is not available here' })).toBeInTheDocument();
    expect(screen.getByText(/never shown in the product/i)).toBeInTheDocument();
    expectNoConfigurationControls();
  });

  it('denies members on direct URL access', async () => {
    mockApi({
      'GET /auth/session': () => json(SESSION),
      'GET /orgs/acme': () => json(ORG_MEMBER),
      ...SHELL,
    });
    renderApp('/o/acme/admin/system/email');
    expect(await screen.findByRole('region', { name: /don't have access/i })).toHaveTextContent(
      /don.t have permission to change/,
    );
    expect(screen.queryByRole('heading', { name: 'Transactional outbox' })).toBeNull();
  });
});

describe('Admin system navigation', () => {
  it('hides System links for members without org.manage', async () => {
    mockApi({
      'GET /auth/session': () => json(SESSION),
      'GET /orgs/acme': () => json(ORG_MEMBER),
      ...SHELL,
    });
    renderApp('/o/acme/admin/general');
    await screen.findByRole('navigation', { name: 'Administration' });
    expect(screen.queryByRole('link', { name: 'Notifications' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Email Delivery' })).toBeNull();
  });

  it('shows System links for org managers', async () => {
    mockApi({
      'GET /auth/session': () => json(SESSION),
      'GET /orgs/acme': () => json(ORG_ADMIN),
      ...SHELL,
    });
    renderApp('/o/acme/admin/general');
    const adminNav = await screen.findByRole('navigation', { name: 'Administration' });
    expect(adminNav).toHaveTextContent('Notifications');
    expect(adminNav).toHaveTextContent('Email Delivery');
  });
});
