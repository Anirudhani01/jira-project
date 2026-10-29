import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { json, mockApi, problem, renderApp, SIGNED_IN } from '../../test/api';

import { lastOrg, rememberOrg } from './api';
import { VERIFY_FIRST_MESSAGE } from './pages/CreateOrgPage';

const VERIFIED = { ...SIGNED_IN, user: { ...SIGNED_IN.user, email_verified: true } };
const ACME = { slug: 'acme', name: 'Acme', role: 'owner' };
const ORG = {
  id: '22222222-2222-2222-2222-222222222222',
  slug: 'acme',
  name: 'Acme',
  role: 'owner',
  permissions: ['org.audit.view', 'org.manage', 'org.members.manage', 'org.view', 'project.create'],
  created_at: '2026-10-27T00:00:00Z',
};

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('CreateOrgPage', () => {
  it('asks unverified users to verify first and shows no form', async () => {
    const calls = mockApi({ 'GET /auth/session': () => json(SIGNED_IN) });
    renderApp('/orgs/new');
    expect(await screen.findByText(VERIFY_FIRST_MESSAGE)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create organization' })).toBeNull();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('creates an organization and opens it', async () => {
    let created = false;
    const calls = mockApi({
      'GET /auth/session': () => json({ ...VERIFIED, orgs: created ? [ACME] : [] }),
      'POST /orgs': () => {
        created = true;
        return json(ACME, 201);
      },
      'GET /orgs/acme': () => json(ORG),
    });
    const { router } = renderApp('/orgs/new');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Name'), 'Acme');
    await user.type(screen.getByLabelText('Address'), 'ACME');
    await user.click(screen.getByRole('button', { name: 'Create organization' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/o/acme');
    });
    const post = calls.find((c) => c.method === 'POST');
    expect(post?.body).toEqual({ name: 'Acme', slug: 'acme' });
    expect(post?.headers.get('x-csrf-token')).toBe('csrf-abc');
    expect(lastOrg()).toBe('acme');
  });

  it('shows a taken address on the field', async () => {
    mockApi({
      'GET /auth/session': () => json(VERIFIED),
      'POST /orgs': () =>
        problem(409, 'slug_unavailable', {
          errors: [{ field: 'body.slug', message: 'is not available' }],
        }),
    });
    renderApp('/orgs/new');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Name'), 'Acme');
    await user.type(screen.getByLabelText('Address'), 'acme');
    await user.click(screen.getByRole('button', { name: 'Create organization' }));
    expect(await screen.findByText('is not available')).toBeInTheDocument();
  });

  it('validates the address format before sending', async () => {
    const calls = mockApi({ 'GET /auth/session': () => json(VERIFIED) });
    renderApp('/orgs/new');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Name'), 'Acme');
    await user.type(screen.getByLabelText('Address'), 'a_b');
    await user.click(screen.getByRole('button', { name: 'Create organization' }));
    expect(await screen.findByText(/lowercase letters, digits or hyphens/)).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });
});

describe('OrgHomePage', () => {
  it('shows the organization and its settings link for managers', async () => {
    mockApi({
      'GET /auth/session': () => json({ ...VERIFIED, orgs: [ACME] }),
      'GET /orgs/acme': () => json(ORG),
    });
    renderApp('/o/acme');
    expect(await screen.findByRole('heading', { level: 1, name: 'Acme' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute(
      'href',
      '/o/acme/settings',
    );
    expect(screen.getByRole('heading', { name: 'Projects' })).toBeInTheDocument();
  });

  it('hides settings from members', async () => {
    mockApi({
      'GET /auth/session': () => json({ ...VERIFIED, orgs: [ACME] }),
      'GET /orgs/acme': () => json({ ...ORG, role: 'member', permissions: ['org.view'] }),
    });
    renderApp('/o/acme');
    await screen.findByRole('heading', { level: 1, name: 'Acme' });
    expect(screen.queryByRole('link', { name: 'Settings' })).toBeNull();
  });

  it('renders not-found for inaccessible organizations', async () => {
    mockApi({
      'GET /auth/session': () => json(VERIFIED),
      'GET /orgs/other': () => problem(404, 'not_found'),
    });
    renderApp('/o/other');
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });
});

describe('OrgSettingsPage', () => {
  it('renames the organization with the CSRF token', async () => {
    const calls = mockApi({
      'GET /auth/session': () => json({ ...VERIFIED, orgs: [ACME] }),
      'GET /orgs/acme': () => json(ORG),
      'PATCH /orgs/acme': () => json({ ...ORG, name: 'Acme 2' }),
    });
    renderApp('/o/acme/settings');
    const user = userEvent.setup();
    const name = await screen.findByLabelText('Name');
    await user.clear(name);
    await user.type(name, 'Acme 2');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Name saved.')).toBeInTheDocument();
    const patch = calls.find((c) => c.method === 'PATCH');
    expect(patch?.body).toEqual({ name: 'Acme 2' });
    expect(patch?.headers.get('x-csrf-token')).toBe('csrf-abc');
  });

  it('shows no form without the manage permission', async () => {
    mockApi({
      'GET /auth/session': () => json({ ...VERIFIED, orgs: [ACME] }),
      'GET /orgs/acme': () => json({ ...ORG, role: 'member', permissions: ['org.view'] }),
    });
    renderApp('/o/acme/settings');
    expect(await screen.findByRole('alert')).toHaveTextContent(/don.t have permission/);
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });
});

describe('home redirect and switcher', () => {
  it('opens the last-used organization when it is still one of mine', async () => {
    rememberOrg('beta');
    mockApi({
      'GET /auth/session': () =>
        json({ ...VERIFIED, orgs: [ACME, { slug: 'beta', name: 'Beta', role: 'member' }] }),
      'GET /orgs/beta': () => json({ ...ORG, slug: 'beta', name: 'Beta' }),
    });
    const { router } = renderApp('/');
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/o/beta');
    });
  });

  it('ignores a remembered org the user no longer belongs to', async () => {
    rememberOrg('gone');
    mockApi({
      'GET /auth/session': () => json({ ...VERIFIED, orgs: [ACME] }),
      'GET /orgs/acme': () => json(ORG),
    });
    const { router } = renderApp('/');
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/o/acme');
    });
  });

  it('sends users without organizations to create one', async () => {
    mockApi({ 'GET /auth/session': () => json(VERIFIED) });
    const { router } = renderApp('/');
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/orgs/new');
    });
  });

  it('switches organization from the header', async () => {
    mockApi({
      'GET /auth/session': () =>
        json({ ...VERIFIED, orgs: [ACME, { slug: 'beta', name: 'Beta', role: 'member' }] }),
      'GET /orgs/acme': () => json(ORG),
      'GET /orgs/beta': () => json({ ...ORG, slug: 'beta', name: 'Beta' }),
    });
    const { router } = renderApp('/o/acme');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Acme/i }));
    await user.click(await screen.findByRole('menuitem', { name: /^Beta/ }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/o/beta');
    });
  });
});
