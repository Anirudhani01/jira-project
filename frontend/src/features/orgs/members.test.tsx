import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { json, mockApi, problem, renderApp, SIGNED_IN } from '../../test/api';

const VERIFIED = {
  ...SIGNED_IN,
  user: { ...SIGNED_IN.user, email_verified: true },
  orgs: [{ slug: 'acme', name: 'Acme', role: 'admin' }],
};
const ORG = {
  id: '22222222-2222-2222-2222-222222222222',
  slug: 'acme',
  name: 'Acme',
  role: 'admin',
  permissions: ['org.audit.view', 'org.manage', 'org.members.manage', 'org.view', 'project.create'],
  created_at: '2026-10-27T00:00:00Z',
};
const MEMBERS = {
  items: [
    {
      user_id: 'o1',
      display_name: 'Olive',
      email: 'o@x.test',
      role: 'owner',
      can_create_projects: false,
      joined_at: '2026-10-27T00:00:00Z',
    },
    {
      user_id: 'm1',
      display_name: 'Max',
      email: 'm@x.test',
      role: 'member',
      can_create_projects: false,
      joined_at: '2026-10-27T00:00:00Z',
    },
  ],
};
const TOKEN = 'tok_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_abcd';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('OrgMembersPage (admin)', () => {
  it('cannot edit owners, can change roles, grant creation and invite', async () => {
    const calls = mockApi({
      'GET /auth/session': () => json(VERIFIED),
      'GET /orgs/acme': () => json(ORG),
      'GET /orgs/acme/members': () => json(MEMBERS),
      'GET /orgs/acme/invitations': () => json({ items: [] }),
      'PATCH /orgs/acme/members/m1': () => new Response(null, { status: 204 }),
      'POST /orgs/acme/invitations': () => json({ status: 'accepted' }, 202),
    });
    renderApp('/o/acme/settings/members');
    const user = userEvent.setup();
    await screen.findByRole('cell', { name: 'Max' });
    expect(screen.queryByLabelText('Role of Olive')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove Olive' })).toBeNull();
    const roleSelect = screen.getByLabelText('Role of Max');
    expect([...(roleSelect as HTMLSelectElement).options].map((o) => o.value)).toEqual([
      'member',
      'admin',
    ]);
    await user.selectOptions(roleSelect, 'admin');
    await user.click(screen.getByLabelText('Max can create projects'));
    await user.type(screen.getByLabelText('Email to invite'), 'new@x.test');
    await user.click(screen.getByRole('button', { name: 'Send invitation' }));
    await screen.findByText('Invitation sent.');
    const patches = calls.filter((c) => c.method === 'PATCH').map((c) => c.body);
    expect(patches).toEqual([{ role: 'admin' }, { can_create_projects: true }]);
    const post = calls.find((c) => c.method === 'POST');
    expect(post?.body).toEqual({ email: 'new@x.test', role: 'member' });
    expect(post?.headers.get('x-csrf-token')).toBe('csrf-abc');
  });

  it('shows the last-owner conflict from the server', async () => {
    mockApi({
      'GET /auth/session': () => json(VERIFIED),
      'GET /orgs/acme': () => json({ ...ORG, role: 'owner' }),
      'GET /orgs/acme/members': () => json(MEMBERS),
      'GET /orgs/acme/invitations': () => json({ items: [] }),
      'PATCH /orgs/acme/members/o1': () =>
        problem(409, 'last_owner', { detail: 'An organization must keep at least one owner.' }),
    });
    renderApp('/o/acme/settings/members');
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByLabelText('Role of Olive'), 'member');
    expect(await screen.findByRole('alert')).toHaveTextContent('must keep at least one owner');
  });
});

describe('AcceptInvitationPage', () => {
  it('accepts on click and links to the organization', async () => {
    const calls = mockApi({
      'GET /auth/session': () => json(VERIFIED),
      'POST /invitations/accept': () => json({ slug: 'acme', name: 'Acme', role: 'member' }),
    });
    const { router } = renderApp(`/invitations/accept#token=${TOKEN}`);
    const button = await screen.findByRole('button', { name: 'Accept invitation' });
    await waitFor(() => {
      expect(router.state.location.hash).toBe('');
    });
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
    await userEvent.setup().click(button);
    expect(await screen.findByRole('link', { name: 'Open Acme' })).toHaveAttribute(
      'href',
      '/o/acme',
    );
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ token: TOKEN });
  });

  it('explains an email mismatch', async () => {
    mockApi({
      'GET /auth/session': () => json(VERIFIED),
      'POST /invitations/accept': () => problem(403, 'invitation_email_mismatch'),
    });
    renderApp(`/invitations/accept#token=${TOKEN}`);
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Accept invitation' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('different email address');
  });

  it('keeps the token across sign-in without putting it in a URL', async () => {
    let signedIn = false;
    const calls = mockApi({
      'GET /auth/session': () => (signedIn ? json(VERIFIED) : problem(401, 'unauthenticated')),
      'POST /auth/login': () => {
        signedIn = true;
        return new Response(null, { status: 204 });
      },
      'POST /invitations/accept': () => json({ slug: 'acme', name: 'Acme', role: 'member' }),
    });
    const { router } = renderApp(`/invitations/accept#token=${TOKEN}`);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('link', { name: 'Sign in to accept' }));
    expect(router.state.location.search).not.toContain(TOKEN);
    await user.type(await screen.findByLabelText('Email'), 'ann@example.com');
    await user.type(screen.getByLabelText('Password'), 'Velvet-Harbor-Lantern-93'); // gitleaks:allow
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await user.click(await screen.findByRole('button', { name: 'Accept invitation' }));
    await screen.findByRole('link', { name: 'Open Acme' });
    expect(calls.find((c) => c.path === '/invitations/accept')?.body).toEqual({ token: TOKEN });
    expect(sessionStorage.getItem('jira.pendingInvitation')).toBeNull();
  });
});
