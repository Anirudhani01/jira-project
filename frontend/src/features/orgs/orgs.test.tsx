import { screen, waitFor, within } from '@testing-library/react';
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

const WEB = {
  key: 'WEB',
  name: 'Website',
  board_type: 'kanban',
  archived: false,
  my_role: 'member',
  issue_count: 4,
  done_count: 2,
  active_sprint: null,
};
const MEMBER_A = {
  user_id: 'o1',
  display_name: 'Olive',
  email: 'o@x.test',
  role: 'owner',
  can_create_projects: false,
  joined_at: '2026-10-27T00:00:00Z',
};
const MEMBER_B = { ...MEMBER_A, user_id: 'm1', display_name: 'Max', email: 'm@x.test' };

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
  it('shows the organization dashboard header and tabs for managers', async () => {
    mockApi({
      'GET /auth/session': () => json({ ...VERIFIED, orgs: [ACME] }),
      'GET /orgs/acme': () => json(ORG),
      'GET /orgs/acme/projects': () => json({ items: [] }),
    });
    renderApp('/o/acme');
    expect(await screen.findByRole('heading', { level: 1, name: 'Acme' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'New project' })).toHaveAttribute(
      'href',
      '/o/acme/projects/new',
    );
    expect(screen.queryByText('Welcome back,')).not.toBeInTheDocument();
    const tabs = screen.getByRole('navigation', { name: 'Organization sections' });
    expect(tabs).toBeInTheDocument();
    expect(tabs.querySelector('a[aria-current="page"]')).toHaveTextContent('Projects');
    const createLinks = screen.getAllByRole('link', { name: 'Create project' });
    expect(createLinks.some((el) => el.getAttribute('href') === '/o/acme/projects/new')).toBe(true);
  });

  it('keeps Get started and the create card on an empty organization', async () => {
    mockApi({
      'GET /auth/session': () => json({ ...VERIFIED, orgs: [ACME] }),
      'GET /orgs/acme': () => json(ORG),
      'GET /orgs/acme/projects': () => json({ items: [] }),
      'GET /orgs/acme/members': () => json({ items: [MEMBER_A] }),
    });
    renderApp('/o/acme');
    expect(await screen.findByRole('heading', { name: 'Get started' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create new project' })).toBeInTheDocument();
  });

  it('hides Get started and the create card once the org has a project and a team', async () => {
    mockApi({
      'GET /auth/session': () => json({ ...VERIFIED, orgs: [ACME] }),
      'GET /orgs/acme': () => json(ORG),
      'GET /orgs/acme/projects': () => json({ items: [WEB] }),
      'GET /orgs/acme/members': () => json({ items: [MEMBER_A, MEMBER_B] }),
    });
    renderApp('/o/acme');
    await screen.findByRole('link', { name: 'WEB — Website' });
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'Get started' })).toBeNull();
    });
    expect(screen.queryByRole('link', { name: 'Create new project' })).toBeNull();
  });

  it('only drops the finished Get started steps', async () => {
    mockApi({
      'GET /auth/session': () => json({ ...VERIFIED, orgs: [ACME] }),
      'GET /orgs/acme': () => json(ORG),
      'GET /orgs/acme/projects': () => json({ items: [WEB] }),
      'GET /orgs/acme/members': () => json({ items: [MEMBER_A] }),
    });
    renderApp('/o/acme');
    expect(await screen.findByRole('heading', { name: 'Invite your team' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Create a project' })).toBeNull();
  });

  it('stars a project from the card menu and lists it under Starred', async () => {
    mockApi({
      'GET /auth/session': () => json({ ...VERIFIED, orgs: [ACME] }),
      'GET /orgs/acme': () => json(ORG),
      'GET /orgs/acme/projects': () => json({ items: [WEB] }),
      'GET /orgs/acme/members': () => json({ items: [MEMBER_A, MEMBER_B] }),
    });
    renderApp('/o/acme');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Actions for Website' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Star project' }));
    const nav = screen.getByRole('navigation', { name: 'Global' });
    expect(await within(nav).findAllByRole('link', { name: /Website/ })).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Actions for Website' }));
    expect(await screen.findByRole('menuitem', { name: 'Unstar project' })).toBeInTheDocument();
  });

  it('shows the role pill only for non-admin roles', async () => {
    mockApi({
      'GET /auth/session': () => json({ ...VERIFIED, orgs: [ACME] }),
      'GET /orgs/acme': () => json(ORG),
      'GET /orgs/acme/projects': () =>
        json({
          items: [WEB, { ...WEB, key: 'OPS', name: 'Ops', my_role: 'admin' }],
        }),
      'GET /orgs/acme/members': () => json({ items: [MEMBER_A, MEMBER_B] }),
    });
    renderApp('/o/acme');
    await screen.findByRole('link', { name: 'OPS — Ops' });
    expect(screen.getAllByText('Member')).toHaveLength(1);
    expect(screen.queryByText('Admin')).toBeNull();
  });

  it('shows the organization totals in the header', async () => {
    mockApi({
      'GET /auth/session': () => json({ ...VERIFIED, orgs: [ACME] }),
      'GET /orgs/acme': () => json(ORG),
      'GET /orgs/acme/projects': () =>
        json({ items: [WEB, { ...WEB, key: 'OPS', name: 'Ops', issue_count: 3, done_count: 0 }] }),
      'GET /orgs/acme/members': () => json({ items: [MEMBER_A, MEMBER_B] }),
    });
    renderApp('/o/acme');
    const totals = await screen.findByLabelText('Organization totals');
    await waitFor(() => {
      expect(totals).toHaveTextContent('2 projects');
    });
    expect(totals).toHaveTextContent('7 issues');
    expect(totals).toHaveTextContent('2 members');
  });

  it('lists projects in a table with real progress and the active sprint', async () => {
    mockApi({
      'GET /auth/session': () => json({ ...VERIFIED, orgs: [ACME] }),
      'GET /orgs/acme': () => json(ORG),
      'GET /orgs/acme/projects': () =>
        json({
          items: [
            WEB,
            {
              ...WEB,
              key: 'MOB',
              name: 'Mobile',
              board_type: 'scrum',
              issue_count: 3,
              done_count: 3,
              active_sprint: 'Sprint 1',
            },
            { ...WEB, key: 'EMP', name: 'Empty', issue_count: 0, done_count: 0 },
          ],
        }),
      'GET /orgs/acme/members': () => json({ items: [MEMBER_A, MEMBER_B] }),
    });
    renderApp('/o/acme');
    const table = await screen.findByRole('table', { name: 'Projects' });
    const rowOf = (name: string) => {
      const row = within(table)
        .getByRole('link', { name: new RegExp(` — ${name}$`) })
        .closest('tr');
      if (!row) throw new Error('row');
      return within(row);
    };
    expect(rowOf('Website').getByRole('progressbar')).toHaveAttribute('aria-valuenow', '2');
    expect(rowOf('Website').getByText('2 / 4')).toBeInTheDocument();
    expect(rowOf('Mobile').getByText('Scrum · Sprint 1')).toBeInTheDocument();
    expect(rowOf('Mobile').getByText('3 / 3')).toBeInTheDocument();
    expect(rowOf('Empty').getByText('No issues')).toBeInTheDocument();
    expect(rowOf('Empty').queryByRole('progressbar')).toBeNull();
  });

  it('switches between the table and the project cards', async () => {
    mockApi({
      'GET /auth/session': () => json({ ...VERIFIED, orgs: [ACME] }),
      'GET /orgs/acme': () => json(ORG),
      'GET /orgs/acme/projects': () => json({ items: [WEB] }),
      'GET /orgs/acme/members': () => json({ items: [MEMBER_A, MEMBER_B] }),
      'GET /orgs/acme/projects/WEB': () => json({ ...WEB, description: 'The public site' }),
      'GET /orgs/acme/projects/WEB/members': () => json({ items: [{ user_id: 'o1' }] }),
    });
    renderApp('/o/acme');
    const user = userEvent.setup();
    expect(await screen.findByRole('table', { name: 'Projects' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Grid view' }));
    expect(await screen.findByText('The public site')).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: 'Projects' })).toBeNull();
    expect(await screen.findByText('4 issues · 1 member')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'List view' }));
    expect(await screen.findByRole('table', { name: 'Projects' })).toBeInTheDocument();
  });

  it('lists the issues the user opened under Recently opened', async () => {
    mockApi({
      'GET /auth/session': () => json({ ...VERIFIED, orgs: [ACME] }),
      'GET /orgs/acme': () => json(ORG),
      'GET /orgs/acme/projects': () => json({ items: [WEB] }),
      'GET /orgs/acme/members': () => json({ items: [MEMBER_A, MEMBER_B] }),
    });
    localStorage.setItem(
      `jira.nav.${VERIFIED.user.id}.acme.recent`,
      JSON.stringify([
        { kind: 'issue', key: 'WEB-4', at: 2 },
        { kind: 'project', key: 'WEB', at: 1 },
      ]),
    );
    renderApp('/o/acme');
    const section = (await screen.findByRole('heading', { name: 'Recently opened' })).closest(
      'section',
    );
    if (!section) throw new Error('section');
    const link = await within(section).findByRole('link', { name: /WEB-4/ });
    expect(link).toHaveAttribute('href', '/o/acme/issues/WEB-4');
    expect(link).toHaveTextContent('Website');
    expect(link).toHaveTextContent('Kanban');
    expect(within(section).getAllByRole('link')).toHaveLength(1);
  });

  it('explains an empty Recently opened list', async () => {
    mockApi({
      'GET /auth/session': () => json({ ...VERIFIED, orgs: [ACME] }),
      'GET /orgs/acme': () => json(ORG),
      'GET /orgs/acme/projects': () => json({ items: [WEB] }),
      'GET /orgs/acme/members': () => json({ items: [MEMBER_A, MEMBER_B] }),
    });
    renderApp('/o/acme');
    expect(await screen.findByText('Issues you open appear here.')).toBeInTheDocument();
  });

  it('opens Members, Audit log and Settings in place under the same header and tabs', async () => {
    mockApi({
      'GET /auth/session': () => json({ ...VERIFIED, orgs: [ACME] }),
      'GET /orgs/acme': () => json(ORG),
      'GET /orgs/acme/projects': () => json({ items: [WEB] }),
      'GET /orgs/acme/members': () => json({ items: [MEMBER_A, MEMBER_B] }),
      'GET /orgs/acme/invitations': () => json({ items: [] }),
      'GET /orgs/acme/audit-events': () => json({ items: [], next_cursor: null }),
      'GET /orgs/acme/notifications/unread-count': () => json({ count: 0 }),
    });
    const { router } = renderApp('/o/acme');
    const user = userEvent.setup();
    const tabs = await screen.findByRole('navigation', { name: 'Organization sections' });

    const open = async (tab: string, path: string, heading: string) => {
      await user.click(within(tabs).getByRole('link', { name: tab }));
      expect(await screen.findByRole('heading', { name: heading, level: 2 })).toBeInTheDocument();
      expect(router.state.location.pathname).toBe(path);
      expect(within(tabs).getByRole('link', { name: tab })).toHaveAttribute('aria-current', 'page');
      // Same page frame: organization name is the only h1, tab strip stays, no Administration shell.
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
      expect(screen.getByRole('heading', { level: 1, name: 'Acme' })).toBeInTheDocument();
      expect(screen.getByRole('navigation', { name: 'Organization sections' })).toBe(tabs);
      expect(screen.queryByRole('navigation', { name: 'Administration' })).toBeNull();
      expect(screen.getByRole('navigation', { name: 'Global' })).toBeInTheDocument();
    };

    await open('Members', '/o/acme/settings/members', 'Members of Acme');
    await open('Audit log', '/o/acme/settings/audit', 'Audit Logs');
    await open('Settings', '/o/acme/settings', 'General');
    expect(within(tabs).getByRole('link', { name: 'Members' })).not.toHaveAttribute('aria-current');

    await user.click(within(tabs).getByRole('link', { name: 'Projects' }));
    expect(await screen.findByRole('heading', { name: 'Recently opened' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/o/acme');
  });

  it('keeps the rest of the settings in Administration, reached from the sidebar', async () => {
    mockApi({
      'GET /auth/session': () => json({ ...VERIFIED, orgs: [ACME] }),
      'GET /orgs/acme': () => json(ORG),
      'GET /orgs/acme/projects': () => json({ items: [WEB] }),
      'GET /orgs/acme/members': () => json({ items: [MEMBER_A, MEMBER_B] }),
      'GET /orgs/acme/notifications/unread-count': () => json({ count: 0 }),
    });
    const { router } = renderApp('/o/acme/settings');
    const user = userEvent.setup();
    const admin = await screen.findByRole('link', { name: 'Administration' });
    expect(admin).toHaveAttribute('href', '/o/acme/admin');
    await user.click(admin);
    expect(await screen.findByRole('navigation', { name: 'Administration' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/o/acme/admin');
    expect(screen.queryByRole('navigation', { name: 'Organization sections' })).toBeNull();
  });

  it('hides org manage settings in the header for members but keeps sidebar settings', async () => {
    mockApi({
      'GET /auth/session': () => json({ ...VERIFIED, orgs: [ACME] }),
      'GET /orgs/acme': () => json({ ...ORG, role: 'member', permissions: ['org.view'] }),
      'GET /orgs/acme/projects': () => json({ items: [] }),
    });
    renderApp('/o/acme');
    await screen.findByRole('heading', { level: 1, name: 'Acme' });
    expect(screen.getByRole('link', { name: 'Administration' })).toHaveAttribute(
      'href',
      '/o/acme/admin',
    );
    expect(screen.getAllByRole('link', { name: 'Settings' }).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('navigation', { name: 'Global' })).toBeInTheDocument();
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

describe('OrgSettingsPage (legacy /settings)', () => {
  const SHELL = {
    'GET /orgs/acme/notifications/unread-count': () => json({ count: 0 }),
  };

  it('renames the organization with the CSRF token', async () => {
    const calls = mockApi({
      'GET /auth/session': () => json({ ...VERIFIED, orgs: [ACME] }),
      'GET /orgs/acme': () => json(ORG),
      'PATCH /orgs/acme': () => json({ ...ORG, name: 'Acme 2' }),
      ...SHELL,
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

  it('lets members view read-only settings without the rename form', async () => {
    mockApi({
      'GET /auth/session': () => json({ ...VERIFIED, orgs: [ACME] }),
      'GET /orgs/acme': () => json({ ...ORG, role: 'member', permissions: ['org.view'] }),
      ...SHELL,
    });
    renderApp('/o/acme/settings');
    expect(await screen.findByRole('heading', { name: 'General' })).toBeInTheDocument();
    expect(screen.getByText(/Only organization owners and admins can change/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(screen.queryByRole('region', { name: /don't have access/i })).toBeNull();
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
