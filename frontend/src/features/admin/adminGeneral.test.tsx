import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { json, mockApi, problem, renderApp, SIGNED_IN } from '../../test/api';

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
  permissions: ['org.view', 'org.manage', 'org.members.manage', 'org.audit.view'],
  created_at: '2026-10-27T00:00:00Z',
};
const ORG_ADMIN = { ...ORG_OWNER, role: 'admin' };
const ORG_MEMBER = { ...ORG_OWNER, role: 'member', permissions: ['org.view'] };
const ORG_SETTINGS = {
  timezone: 'UTC',
  locale: 'en-US',
  story_points_enabled: true,
  story_points_max: 100,
  updated_at: '2026-10-27T00:00:00Z',
};
const SHELL = {
  'GET /orgs/acme/notifications/unread-count': () => json({ count: 0 }),
  'GET /orgs/acme/settings': () => json(ORG_SETTINGS),
};

describe('Admin General settings', () => {
  it('owner can rename on admin/general', async () => {
    const calls = mockApi({
      'GET /auth/session': () => json(SESSION),
      'GET /orgs/acme': () => json(ORG_OWNER),
      'PATCH /orgs/acme': () => json({ ...ORG_OWNER, name: 'Acme 2' }),
      ...SHELL,
    });
    renderApp('/o/acme/admin/general');
    const user = userEvent.setup();
    const name = await screen.findByLabelText('Name');
    await user.clear(name);
    await user.type(name, 'Acme 2');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Name saved.')).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ name: 'Acme 2' });
  });

  it('admin can rename on admin/general', async () => {
    mockApi({
      'GET /auth/session': () => json(SESSION),
      'GET /orgs/acme': () => json(ORG_ADMIN),
      'PATCH /orgs/acme': () => json({ ...ORG_ADMIN, name: 'Acme Admin' }),
      ...SHELL,
    });
    renderApp('/o/acme/admin/general');
    const user = userEvent.setup();
    await user.clear(await screen.findByLabelText('Name'));
    await user.type(screen.getByLabelText('Name'), 'Acme Admin');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Name saved.')).toBeInTheDocument();
  });

  it('member can view read-only general settings', async () => {
    mockApi({
      'GET /auth/session': () => json(SESSION),
      'GET /orgs/acme': () => json(ORG_MEMBER),
      ...SHELL,
    });
    renderApp('/o/acme/admin/general');
    expect(await screen.findByRole('heading', { name: 'General' })).toBeInTheDocument();
    expect(
      screen.getByText(/Only organization owners and admins can change the display name/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Only organization owners and admins can change regional preferences/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(screen.getByText(/cannot be changed/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Defaults & Catalogs' })).toHaveAttribute(
      'href',
      '/o/acme/admin/catalogs',
    );
    expect(screen.getByRole('link', { name: 'Open Members' })).toHaveAttribute(
      'href',
      '/o/acme/admin/members',
    );
  });

  it('shows slug immutability and lifecycle copy', async () => {
    mockApi({
      'GET /auth/session': () => json(SESSION),
      'GET /orgs/acme': () => json(ORG_OWNER),
      ...SHELL,
    });
    renderApp('/o/acme/admin/general');
    await screen.findByRole('heading', { name: 'Organization profile' });
    expect(screen.getByText('acme')).toBeInTheDocument();
    expect(screen.getByText('/o/acme')).toBeInTheDocument();
    expect(screen.getByText(/deactivation and deletion are not available/i)).toBeInTheDocument();
  });

  it('copies organization id to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(navigator.clipboard, 'writeText').mockImplementation(writeText);
    mockApi({
      'GET /auth/session': () => json(SESSION),
      'GET /orgs/acme': () => json(ORG_OWNER),
      ...SHELL,
    });
    renderApp('/o/acme/admin/general');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Copy organization ID' }));
    expect(writeText).toHaveBeenCalledWith(ORG_OWNER.id);
    expect(await screen.findByRole('status')).toHaveTextContent('Copied to clipboard.');
  });

  it('surfaces rename API errors', async () => {
    mockApi({
      'GET /auth/session': () => json(SESSION),
      'GET /orgs/acme': () => json(ORG_OWNER),
      'PATCH /orgs/acme': () => problem(500, 'internal_error'),
      ...SHELL,
    });
    renderApp('/o/acme/admin/general');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/something went wrong/i)).toBeInTheDocument();
  });
});
