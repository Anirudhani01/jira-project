import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { json, mockApi, problem, renderApp, SIGNED_IN } from '../../test/api';

const SESSION = {
  ...SIGNED_IN,
  user: { ...SIGNED_IN.user, email_verified: true },
  orgs: [{ slug: 'acme', name: 'Acme', role: 'owner' }],
};
const ORG_ADMIN = {
  id: '22222222-2222-2222-2222-222222222222',
  slug: 'acme',
  name: 'Acme Corp',
  role: 'owner',
  permissions: ['org.view', 'org.manage', 'org.members.manage', 'org.audit.view', 'project.create'],
  created_at: '2026-10-27T00:00:00Z',
};
const ORG_MEMBER = {
  ...ORG_ADMIN,
  name: 'Acme',
  role: 'member',
  permissions: ['org.view', 'project.create'],
};
const SHELL = {
  'GET /orgs/acme/notifications/unread-count': () => json({ count: 0 }),
};
const MEMBERS = [
  {
    user_id: 'u1',
    email: 'a@example.com',
    display_name: 'Ann',
    role: 'owner',
    can_create_projects: true,
  },
  {
    user_id: 'u2',
    email: 'b@example.com',
    display_name: 'Bob',
    role: 'member',
    can_create_projects: false,
  },
];
const PROJECTS = [
  { key: 'WEB', name: 'Website', board_type: 'kanban', archived: false, my_role: 'admin' },
  { key: 'MOB', name: 'Mobile', board_type: 'kanban', archived: false, my_role: 'member' },
];
function overviewOrgSection(): HTMLElement {
  const heading = document.getElementById('admin-overview-context');
  const section = heading?.closest('section');
  if (!section) throw new Error('Expected organization overview section');
  return section;
}

const INVITES = [
  {
    id: 'inv-1',
    email: 'new@example.com',
    role: 'member',
    created_at: '2026-10-28T00:00:00Z',
    expires_at: '2026-11-28T00:00:00Z',
    expired: false,
  },
];

describe('AdminOverviewPage', () => {
  it('shows organization context and statistics for administrators', async () => {
    mockApi({
      'GET /auth/session': () => json(SESSION),
      'GET /orgs/acme': () => json(ORG_ADMIN),
      'GET /orgs/acme/members': () => json({ items: MEMBERS }),
      'GET /orgs/acme/projects': () => json({ items: PROJECTS }),
      'GET /orgs/acme/invitations': () => json({ items: INVITES }),
      ...SHELL,
    });
    renderApp('/o/acme/admin');
    expect(
      await screen.findByRole('heading', { name: 'Administration overview' }),
    ).toBeInTheDocument();
    const orgSection = overviewOrgSection();
    expect(within(orgSection).getByText('Acme Corp')).toBeInTheDocument();
    expect(within(orgSection).getByText(/\/o\/acme/)).toBeInTheDocument();
    const membersGroup = await screen.findByRole('group', { name: 'Members' });
    expect(await within(membersGroup).findByText('2')).toBeInTheDocument();
    const projectsGroup = screen.getByRole('group', { name: 'Projects you can access' });
    expect(await within(projectsGroup).findByText('2')).toBeInTheDocument();
    const invitesGroup = screen.getByRole('group', { name: 'Pending invitations' });
    expect(await within(invitesGroup).findByText('1')).toBeInTheDocument();
    expect(screen.queryByText(/total issues/i)).toBeNull();
    expect(screen.queryByText(/total organization projects/i)).toBeNull();
  });

  it('shows permission-filtered quick links and hides audit for members', async () => {
    mockApi({
      'GET /auth/session': () => json(SESSION),
      'GET /orgs/acme': () => json(ORG_MEMBER),
      'GET /orgs/acme/members': () => json({ items: MEMBERS }),
      'GET /orgs/acme/projects': () => json({ items: [PROJECTS[1] as (typeof PROJECTS)[number]] }),
      ...SHELL,
    });
    renderApp('/o/acme/admin');
    const linksHeading = await screen.findByRole('heading', { name: 'Administration areas' });
    const linksSection = linksHeading.closest('section');
    if (!linksSection) throw new Error('Expected administration links section');
    const quickLinks = within(linksSection);
    expect(quickLinks.getByRole('link', { name: 'General' })).toBeInTheDocument();
    expect(quickLinks.getByRole('link', { name: 'Members' })).toBeInTheDocument();
    expect(quickLinks.queryByRole('link', { name: 'Audit Logs' })).toBeNull();
    expect(quickLinks.queryByRole('link', { name: 'Notifications' })).toBeNull();
    expect(quickLinks.queryByRole('link', { name: 'Overview' })).toBeNull();
  });

  it('does not fetch invitations without org.members.manage', async () => {
    const calls = mockApi({
      'GET /auth/session': () => json(SESSION),
      'GET /orgs/acme': () => json(ORG_MEMBER),
      'GET /orgs/acme/members': () => json({ items: MEMBERS }),
      'GET /orgs/acme/projects': () => json({ items: [] }),
      ...SHELL,
    });
    renderApp('/o/acme/admin');
    expect(await screen.findByRole('heading', { name: 'At a glance' })).toBeInTheDocument();
    expect(screen.queryByText('Pending invitations')).toBeNull();
    expect(calls.some((c) => c.method === 'GET' && c.path === '/orgs/acme/invitations')).toBe(
      false,
    );
  });

  it('loads member and project stats independently and retries on failure', async () => {
    let membersFail = true;
    mockApi({
      'GET /auth/session': () => json(SESSION),
      'GET /orgs/acme': () => json(ORG_ADMIN),
      'GET /orgs/acme/members': () => {
        if (membersFail) return problem(500, 'internal_error');
        return json({ items: MEMBERS });
      },
      'GET /orgs/acme/projects': () => json({ items: PROJECTS }),
      'GET /orgs/acme/invitations': () => json({ items: [] }),
      ...SHELL,
    });
    renderApp('/o/acme/admin');
    const membersGroup = await screen.findByRole('group', { name: 'Members' });
    await waitFor(() => {
      expect(within(membersGroup).getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    });
    expect(
      within(screen.getByRole('group', { name: 'Projects you can access' })).getByText('2'),
    ).toBeInTheDocument();
    membersFail = false;
    const user = userEvent.setup();
    await user.click(within(membersGroup).getByRole('button', { name: 'Retry' }));
    expect(await within(membersGroup).findByText('2')).toBeInTheDocument();
    expect(within(membersGroup).queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('shows empty hints when counts are zero', async () => {
    mockApi({
      'GET /auth/session': () => json(SESSION),
      'GET /orgs/acme': () => json(ORG_ADMIN),
      'GET /orgs/acme/members': () => json({ items: [] }),
      'GET /orgs/acme/projects': () => json({ items: [] }),
      'GET /orgs/acme/invitations': () => json({ items: [] }),
      ...SHELL,
    });
    renderApp('/o/acme/admin');
    expect(await screen.findByText('No members listed yet.')).toBeInTheDocument();
    expect(screen.getByText('You are not on any active projects yet.')).toBeInTheDocument();
    expect(screen.getByText('No outstanding invitations.')).toBeInTheDocument();
  });
});
