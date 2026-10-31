import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { json, mockApi, renderApp, SIGNED_IN } from '../../test/api';

import { SIDEBAR_COLLAPSED_KEY } from './storage';

const SESSION = {
  ...SIGNED_IN,
  user: { ...SIGNED_IN.user, email_verified: true },
  orgs: [{ slug: 'acme', name: 'Acme', role: 'member' }],
};

const PROJECT_KANBAN = {
  id: '33333333-3333-3333-3333-333333333333',
  key: 'WEB',
  name: 'Website',
  description: null,
  board_type: 'kanban' as const,
  archived: false,
  my_role: 'viewer',
  permissions: ['project.view'],
  created_at: '2026-10-27T00:00:00Z',
};

const PROJECT_SCRUM = { ...PROJECT_KANBAN, board_type: 'scrum' as const };

const BOARD = {
  project_key: 'WEB',
  board_type: 'kanban',
  truncated: false,
  sprint: null,
  columns: [
    {
      id: 'c1',
      name: 'To Do',
      position: 0,
      wip_limit: null,
      status_ids: ['s1'],
      count: 0,
      over_wip_limit: false,
      issues: [],
    },
  ],
  transitions: [],
};

const UNREAD = { 'GET /orgs/acme/notifications/unread-count': () => json({ count: 0 }) };

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

function mockProject(project: typeof PROJECT_KANBAN) {
  mockApi({
    'GET /auth/session': () => json(SESSION),
    ...UNREAD,
    'GET /orgs/acme/projects': () =>
      json({
        items: [
          {
            key: project.key,
            name: project.name,
            board_type: project.board_type,
            archived: false,
            my_role: 'viewer',
          },
        ],
      }),
    [`GET /orgs/acme/projects/${project.key}`]: () => json(project),
    [`GET /orgs/acme/projects/${project.key}/board`]: () => json(BOARD),
  });
}

describe('app shell (PR 2)', () => {
  it('shows org navigation and hides project sidebar on org home', async () => {
    mockApi({
      'GET /auth/session': () => json(SESSION),
      'GET /orgs/acme': () =>
        json({
          id: '1',
          slug: 'acme',
          name: 'Acme',
          role: 'member',
          permissions: ['org.view'],
          created_at: '2026-10-27T00:00:00Z',
        }),
      'GET /orgs/acme/projects': () => json({ items: [] }),
      'GET /orgs/acme/members': () => json({ items: [] }),
    });
    renderApp('/o/acme');
    await screen.findByRole('navigation', { name: 'Primary' });
    expect(await screen.findByRole('navigation', { name: 'Organization' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
    await screen.findByRole('heading', { level: 1, name: 'Acme' });
    expect(
      screen.getByRole('combobox', { name: /search projects, issues, or people/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Search projects' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Project' })).toBeNull();
  });

  it('hides org sidebar and shows administration navigation on admin routes', async () => {
    mockApi({
      'GET /auth/session': () => json(SESSION),
      'GET /orgs/acme': () =>
        json({
          id: '1',
          slug: 'acme',
          name: 'Acme',
          role: 'owner',
          permissions: ['org.view', 'org.manage', 'org.members.manage', 'org.audit.view'],
          created_at: '2026-10-27T00:00:00Z',
        }),
      'GET /orgs/acme/projects': () => json({ items: [] }),
      'GET /orgs/acme/members': () => json({ items: [] }),
    });
    const { container } = renderApp('/o/acme/admin/general');
    expect(await screen.findByRole('navigation', { name: 'Administration' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to workspace' })).toHaveAttribute(
      'href',
      '/o/acme',
    );
    expect(screen.queryByRole('navigation', { name: 'Organization' })).toBeNull();
    expect(container.querySelector('.admin-shell')).toBeTruthy();
    expect(
      await screen.findByRole('heading', { name: 'Organization settings' }),
    ).toBeInTheDocument();
  });

  it('global search on org settings navigates to org home with query on Enter', async () => {
    const user = userEvent.setup();
    mockApi({
      'GET /auth/session': () => json(SESSION),
      'GET /orgs/acme': () =>
        json({
          id: '1',
          slug: 'acme',
          name: 'Acme',
          role: 'member',
          permissions: ['org.view'],
          created_at: '2026-10-27T00:00:00Z',
        }),
      'GET /orgs/acme/projects': () => json({ items: [] }),
      'GET /orgs/acme/members': () => json({ items: [] }),
    });
    const { router } = renderApp('/o/acme/settings');
    await screen.findByRole('navigation', { name: 'Primary' });
    await screen.findByRole('heading', { name: 'Organization settings' });
    const search = screen.getByRole('combobox', { name: /search projects, issues, or people/i });
    await user.type(search, 'website');
    await user.keyboard('{Enter}');
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/o/acme');
      expect(router.state.location.search).toBe('?q=website');
    });
  });

  it('shows project nav with Board and Issues for kanban (no Backlog)', async () => {
    mockProject(PROJECT_KANBAN);
    renderApp('/o/acme/p/WEB/board');
    const projectNav = await screen.findByRole('navigation', { name: 'Project' });
    expect(projectNav).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Board' })).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByRole('link', { name: 'Backlog' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Issues' })).toBeInTheDocument();
  });

  it('shows board-shell top search on the board route only', async () => {
    mockProject(PROJECT_KANBAN);
    const { container } = renderApp('/o/acme/p/WEB/board');
    await screen.findByRole('navigation', { name: 'Project' });
    expect(container.querySelector('.board-shell')).toBeTruthy();
    expect(
      await screen.findByRole('combobox', { name: /search issues and projects/i }),
    ).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /^Create$/i })).toBeInTheDocument();
  });

  it('shows Backlog for scrum projects', async () => {
    mockApi({
      'GET /auth/session': () => json(SESSION),
      ...UNREAD,
      'GET /orgs/acme/projects': () =>
        json({
          items: [
            {
              key: 'WEB',
              name: 'Website',
              board_type: 'scrum',
              archived: false,
              my_role: 'viewer',
            },
          ],
        }),
      'GET /orgs/acme/projects/WEB': () => json(PROJECT_SCRUM),
      'GET /orgs/acme/projects/WEB/backlog': () =>
        json({ project_key: 'WEB', backlog: [], sprints: [] }),
    });
    renderApp('/o/acme/p/WEB/backlog');
    expect(await screen.findByRole('link', { name: 'Backlog' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('persists sidebar collapse in localStorage', async () => {
    mockProject(PROJECT_KANBAN);
    renderApp('/o/acme/p/WEB/board');
    const user = userEvent.setup();
    await screen.findByRole('navigation', { name: 'Project' });
    await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    await waitFor(() => {
      expect(localStorage.getItem(SIDEBAR_COLLAPSED_KEY)).toBe('1');
    });
  });

  it('navigates Board → Issues via the project sidebar', async () => {
    mockApi({
      'GET /auth/session': () => json(SESSION),
      ...UNREAD,
      'GET /orgs/acme/projects': () =>
        json({
          items: [
            {
              key: 'WEB',
              name: 'Website',
              board_type: 'kanban',
              archived: false,
              my_role: 'viewer',
            },
          ],
        }),
      'GET /orgs/acme/projects/WEB': () => json(PROJECT_KANBAN),
      'GET /orgs/acme/projects/WEB/board': () => json(BOARD),
      'GET /orgs/acme/projects/WEB/issues': () => json({ items: [], next_cursor: null }),
      'GET /orgs/acme/issues/types': () => json({ items: [] }),
      'GET /orgs/acme/issues/priorities': () => json({ items: [] }),
    });
    const { router } = renderApp('/o/acme/p/WEB/board');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('link', { name: 'Issues' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/o/acme/p/WEB/issues');
    });
  });
});
