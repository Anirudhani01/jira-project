import { screen, waitFor, within } from '@testing-library/react';
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
  permissions: ['org.view', 'org.manage'],
  created_at: '2026-10-27T00:00:00Z',
};
const PROJECT = {
  id: '33333333-3333-3333-3333-333333333333',
  key: 'WEB',
  name: 'Website',
  description: null,
  board_type: 'kanban',
  archived: false,
  my_role: 'admin',
  permissions: ['project.manage', 'project.view', 'issue.edit', 'issue.create'],
  created_at: '2026-10-27T00:00:00Z',
};
const TASK = { id: 't-task', name: 'Task', kind: 'standard', position: 2, is_active: true };
const SUBTASK = { id: 't-sub', name: 'Sub-task', kind: 'subtask', position: 4, is_active: true };
const MEDIUM = { id: 'p-med', name: 'Medium', sort_order: 2, color: '#888888', is_active: true };
const ISSUE = {
  id: '55555555-5555-5555-5555-555555555555',
  key: 'WEB-1',
  project_key: 'WEB',
  summary: 'Login button misaligned',
  description: null,
  type: { id: TASK.id, name: 'Task', kind: 'standard' },
  status: { id: 's1', name: 'To Do', category: 'todo' },
  priority: { id: MEDIUM.id, name: 'Medium', color: MEDIUM.color },
  reporter: { id: SIGNED_IN.user.id, display_name: 'Ann Example' },
  assignee: null,
  parent: null,
  labels: [],
  version: 3,
  created_at: '2026-10-28T00:00:00Z',
  updated_at: '2026-10-28T00:00:00Z',
};
const MOVED = { ...ISSUE, key: 'OPS-1', project_key: 'OPS', version: 4 };

const BASE = {
  'GET /auth/session': () => json(SESSION),
  'GET /orgs/acme': () => json(ORG),
  'GET /orgs/acme/projects/WEB': () => json(PROJECT),
  'GET /orgs/acme/projects/WEB/members': () => json({ items: [] }),
  'GET /orgs/acme/projects/WEB/labels': () => json({ items: [] }),
  'GET /orgs/acme/projects/WEB/sprints': () => json({ items: [] }),
  'GET /orgs/acme/issue-types': () => json({ items: [TASK, SUBTASK] }),
  'GET /orgs/acme/priorities': () => json({ items: [MEDIUM] }),
};
const DETAIL = (issue: typeof ISSUE) => ({
  [`GET /orgs/acme/issues/${issue.key}`]: () => json(issue),
  [`GET /orgs/acme/issues/${issue.key}/activity`]: () => json({ items: [], next_cursor: null }),
  [`GET /orgs/acme/issues/${issue.key}/transitions`]: () => json({ items: [] }),
  [`GET /orgs/acme/issues/${issue.key}/children`]: () => json({ items: [], done: 0, total: 0 }),
  [`GET /orgs/acme/issues/${issue.key}/comments`]: () => json({ items: [], next_cursor: null }),
});
const PROJECT_LIST = {
  items: [
    { key: 'WEB', name: 'Website', board_type: 'kanban', archived: false, my_role: 'admin' },
    { key: 'OPS', name: 'Operations', board_type: 'kanban', archived: false, my_role: 'member' },
    { key: 'OLD', name: 'Legacy', board_type: 'kanban', archived: true, my_role: 'member' },
  ],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('old project keys', () => {
  it('redirects a retired project key to the current one and keeps the tab', async () => {
    mockApi({
      ...BASE,
      // The API serves the project under its old key and reports the current key.
      'GET /orgs/acme/projects/WEB': () => json({ ...PROJECT, key: 'SHOP' }),
    });
    const { router } = renderApp('/o/acme/p/WEB?tab=members');
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/o/acme/p/SHOP');
    });
    expect(router.state.location.search).toBe('?tab=members');
  });

  it('redirects nested project pages too', async () => {
    mockApi({
      ...BASE,
      'GET /orgs/acme/projects/WEB': () => json({ ...PROJECT, key: 'SHOP' }),
    });
    const { router } = renderApp('/o/acme/p/web/board');
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/o/acme/p/SHOP/board');
    });
  });

  it('does not redirect when the key is current', async () => {
    mockApi({ ...BASE, 'GET /orgs/acme/projects/WEB/workflow': () => problem(404, 'not_found') });
    const { router } = renderApp('/o/acme/p/WEB?tab=details');
    await screen.findByRole('heading', { name: /WEB — Website/ });
    expect(router.state.location.pathname).toBe('/o/acme/p/WEB');
  });
});

describe('renaming the project key', () => {
  async function openRenameForm() {
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Change project key' }));
    const input = screen.getByLabelText('New project key');
    await user.clear(input);
    return { user, input };
  }

  it('lets org owners/admins rename the key and moves to the new address', async () => {
    const calls = mockApi({
      ...BASE,
      'PATCH /orgs/acme/projects/WEB': () => json({ ...PROJECT, key: 'SHOP' }),
      'GET /orgs/acme/projects/SHOP': () => json({ ...PROJECT, key: 'SHOP' }),
    });
    const { router } = renderApp('/o/acme/p/WEB?tab=details');
    const { user, input } = await openRenameForm();
    await user.type(input, 'shop');
    await user.click(screen.getByRole('button', { name: 'Rename key' }));
    await waitFor(() => {
      expect(calls.some((c) => c.method === 'PATCH')).toBe(true);
    });
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ key: 'SHOP' });
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/o/acme/p/SHOP');
    });
  });

  it('shows the server error when the key is already taken', async () => {
    mockApi({
      ...BASE,
      'PATCH /orgs/acme/projects/WEB': () =>
        problem(409, 'project_key_taken', {
          errors: [{ field: 'body.key', message: 'is already used' }],
        }),
    });
    const { router } = renderApp('/o/acme/p/WEB?tab=details');
    const { user, input } = await openRenameForm();
    await user.type(input, 'OPS');
    await user.click(screen.getByRole('button', { name: 'Rename key' }));
    expect(await screen.findByText('is already used')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/o/acme/p/WEB');
  });

  it('rejects an invalid key before calling the API', async () => {
    const calls = mockApi({ ...BASE });
    renderApp('/o/acme/p/WEB?tab=details');
    const { user, input } = await openRenameForm();
    await user.type(input, '1x');
    await user.click(screen.getByRole('button', { name: 'Rename key' }));
    expect(await screen.findByText(/Use 2-10 letters or digits/)).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
  });

  it('hides the rename control from people without org.manage', async () => {
    const calls = mockApi({
      ...BASE,
      'GET /orgs/acme': () => json({ ...ORG, role: 'member', permissions: ['org.view'] }),
    });
    renderApp('/o/acme/p/WEB?tab=details');
    await screen.findByRole('heading', { name: /WEB — Website/ });
    await waitFor(() => {
      expect(calls.some((c) => c.path === '/orgs/acme')).toBe(true);
    });
    expect(screen.queryByRole('button', { name: 'Change project key' })).not.toBeInTheDocument();
  });
});

describe('moving an issue between projects', () => {
  it('redirects an old issue key to the issue under its current key', async () => {
    mockApi({
      ...BASE,
      ...DETAIL(ISSUE),
      // WEB-1 was moved: the API answers the old key with the issue under its new key.
      'GET /orgs/acme/issues/WEB-1': () => json(MOVED),
      'GET /orgs/acme/issues/OPS-1': () => json(MOVED),
      ...DETAIL(MOVED),
    });
    const { router } = renderApp('/o/acme/issues/WEB-1');
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/o/acme/issues/OPS-1');
    });
  });

  it('moves the issue with If-Match and opens it under the new key', async () => {
    const calls = mockApi({
      ...BASE,
      ...DETAIL(ISSUE),
      ...DETAIL(MOVED),
      'GET /orgs/acme/projects': () => json(PROJECT_LIST),
      'POST /orgs/acme/issues/WEB-1/relocate': () => json(MOVED),
    });
    const { router } = renderApp('/o/acme/issues/WEB-1');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Issue actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Move to project…' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('combobox', { name: /Target project/ }));
    // The current project and archived projects are not offered.
    expect(await screen.findByRole('option', { name: /OPS/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /OLD/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /WEB/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('option', { name: /OPS/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Move issue' }));
    await waitFor(() => {
      expect(calls.some((c) => c.path.endsWith('/relocate'))).toBe(true);
    });
    const post = calls.find((c) => c.path.endsWith('/relocate'));
    expect(post?.headers.get('If-Match')).toBe('"v3"');
    expect(post?.body).toEqual({ target_project_key: 'OPS' });
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/o/acme/issues/OPS-1');
    });
  });

  it('shows why a move was refused', async () => {
    mockApi({
      ...BASE,
      ...DETAIL(ISSUE),
      'GET /orgs/acme/projects': () => json(PROJECT_LIST),
      'POST /orgs/acme/issues/WEB-1/relocate': () =>
        problem(422, 'has_children', {
          detail:
            "Move or remove this issue's children first; issues with children cannot be moved.",
        }),
    });
    renderApp('/o/acme/issues/WEB-1');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Issue actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Move to project…' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('combobox', { name: /Target project/ }));
    await user.click(await screen.findByRole('option', { name: /OPS/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Move issue' }));
    expect(
      await within(dialog).findByText(/Move or remove this issue's children first/),
    ).toBeInTheDocument();
  });

  it('does not offer to move a sub-task', async () => {
    const subtask = {
      ...ISSUE,
      type: { id: SUBTASK.id, name: 'Sub-task', kind: 'subtask' },
    };
    mockApi({ ...BASE, ...DETAIL(subtask) });
    renderApp('/o/acme/issues/WEB-1');
    await screen.findByRole('heading', { name: /Login button misaligned/ });
    expect(screen.queryByRole('button', { name: 'Issue actions' })).not.toBeInTheDocument();
  });

  it('does not offer the move without issue.edit', async () => {
    mockApi({
      ...BASE,
      'GET /orgs/acme/projects/WEB': () =>
        json({ ...PROJECT, permissions: ['project.view'], my_role: 'viewer' }),
      ...DETAIL(ISSUE),
    });
    renderApp('/o/acme/issues/WEB-1');
    await screen.findByRole('heading', { name: /Login button misaligned/ });
    expect(screen.queryByRole('button', { name: 'Issue actions' })).not.toBeInTheDocument();
  });
});
