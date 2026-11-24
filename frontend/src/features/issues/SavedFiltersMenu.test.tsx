import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { json, mockApi, problem, renderApp, SIGNED_IN } from '../../test/api';

const SESSION = {
  ...SIGNED_IN,
  user: { ...SIGNED_IN.user, email_verified: true },
  orgs: [{ slug: 'acme', name: 'Acme', role: 'member' }],
};
const PROJECT = {
  id: '33333333-3333-3333-3333-333333333333',
  key: 'WEB',
  name: 'Website',
  description: null,
  board_type: 'kanban',
  archived: false,
  my_role: 'member',
  permissions: ['issue.create', 'issue.edit', 'project.view'],
  created_at: '2026-10-27T00:00:00Z',
};
const SAVED = {
  id: '77777777-7777-7777-7777-777777777777',
  name: 'My open bugs',
  params: { assignee: 'me', status_category: 'todo' },
  created_at: '2026-11-14T00:00:00Z',
  updated_at: '2026-11-14T00:00:00Z',
};
const CONFIG = {
  'GET /auth/session': () => json(SESSION),
  'GET /orgs/acme/projects/WEB': () => json(PROJECT),
  'GET /orgs/acme/issue-types': () => json({ items: [] }),
  'GET /orgs/acme/priorities': () => json({ items: [] }),
  'GET /orgs/acme/projects/WEB/members': () => json({ items: [] }),
  'GET /orgs/acme/projects/WEB/labels': () => json({ items: [] }),
  'GET /orgs/acme/projects/WEB/sprints': () => json({ items: [] }),
  'GET /orgs/acme/issues': () => json({ items: [], next_cursor: null }),
};
const SAVED_PATH = '/orgs/acme/projects/WEB/saved-filters';

afterEach(() => {
  vi.unstubAllGlobals();
});

async function openMenu() {
  await userEvent.click(await screen.findByRole('button', { name: 'Saved filters' }));
  return screen.findByRole('dialog');
}

describe('saved filters menu', () => {
  it('explains the empty state and cannot save without a filter', async () => {
    mockApi({ ...CONFIG, [`GET ${SAVED_PATH}`]: () => json({ items: [] }) });
    renderApp('/o/acme/p/WEB/issues');
    const menu = await openMenu();
    expect(await within(menu).findByText(/No saved filters yet/)).toBeInTheDocument();
    expect(within(menu).getByRole('button', { name: /Save current filters/ })).toBeDisabled();
  });

  it('saves the current filters, search and sort under a name', async () => {
    const calls = mockApi({
      ...CONFIG,
      [`GET ${SAVED_PATH}`]: () => json({ items: [] }),
      [`POST ${SAVED_PATH}`]: () => json({ ...SAVED, name: 'Login todo' }, 201),
    });
    renderApp('/o/acme/p/WEB/issues?status_category=todo&q=login&foo=bar');
    const menu = await openMenu();
    await userEvent.click(within(menu).getByRole('button', { name: /Save current filters/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Save current filters' });
    const save = within(dialog).getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText('Name'), '  Login todo ');
    await userEvent.click(save);
    await waitFor(() => {
      expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
        name: 'Login todo',
        params: { status_category: 'todo', q: 'login' },
      });
    });
    await waitFor(() => {
      expect(
        screen.queryByRole('dialog', { name: 'Save current filters' }),
      ).not.toBeInTheDocument();
    });
  });

  it('shows the server message when the name is already used', async () => {
    mockApi({
      ...CONFIG,
      [`GET ${SAVED_PATH}`]: () => json({ items: [SAVED] }),
      [`POST ${SAVED_PATH}`]: () =>
        problem(409, 'saved_filter_name_taken', {
          detail: 'You already have a saved filter with this name.',
        }),
    });
    renderApp('/o/acme/p/WEB/issues?type=t1');
    const menu = await openMenu();
    await userEvent.click(within(menu).getByRole('button', { name: /Save current filters/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Save current filters' });
    await userEvent.type(within(dialog).getByLabelText('Name'), 'My open bugs');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText(/already have a saved filter/)).toBeInTheDocument();
  });

  it('applies a saved filter to the list and marks it as current', async () => {
    const calls = mockApi({
      ...CONFIG,
      [`GET ${SAVED_PATH}`]: () => json({ items: [SAVED] }),
    });
    renderApp('/o/acme/p/WEB/issues?type=old&foo=bar');
    let menu = await openMenu();
    await userEvent.click(await within(menu).findByRole('button', { name: 'My open bugs' }));
    await waitFor(() => {
      const last = calls.filter((c) => c.method === 'GET' && c.path === '/orgs/acme/issues').at(-1);
      expect(last?.search).toContain('assignee=me');
      expect(last?.search).toContain('status_category=todo');
      expect(last?.search).not.toContain('type=old');
    });
    menu = await openMenu();
    expect(within(menu).getByRole('button', { name: 'My open bugs' })).toHaveAttribute(
      'aria-current',
      'true',
    );
  });

  it('renames a saved filter', async () => {
    const calls = mockApi({
      ...CONFIG,
      [`GET ${SAVED_PATH}`]: () => json({ items: [SAVED] }),
      [`PATCH ${SAVED_PATH}/${SAVED.id}`]: () => json({ ...SAVED, name: 'Bugs' }),
    });
    renderApp('/o/acme/p/WEB/issues');
    const menu = await openMenu();
    await userEvent.click(await within(menu).findByRole('button', { name: 'Rename My open bugs' }));
    const dialog = await screen.findByRole('dialog', { name: 'Rename saved filter' });
    const name = within(dialog).getByLabelText('Name');
    expect(name).toHaveValue('My open bugs');
    await userEvent.clear(name);
    await userEvent.type(name, 'Bugs');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Rename' }));
    await waitFor(() => {
      expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ name: 'Bugs' });
    });
  });

  it('asks before deleting a saved filter', async () => {
    const calls = mockApi({
      ...CONFIG,
      [`GET ${SAVED_PATH}`]: () => json({ items: [SAVED] }),
      [`DELETE ${SAVED_PATH}/${SAVED.id}`]: () => new Response(null, { status: 204 }),
    });
    renderApp('/o/acme/p/WEB/issues');
    const menu = await openMenu();
    await userEvent.click(await within(menu).findByRole('button', { name: 'Delete My open bugs' }));
    const dialog = await screen.findByRole('dialog', { name: /Delete .My open bugs.\?/ });
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => {
      expect(calls.some((c) => c.method === 'DELETE')).toBe(true);
    });
  });

  it('offers a retry when the saved filters cannot be loaded', async () => {
    let fail = true;
    mockApi({
      ...CONFIG,
      [`GET ${SAVED_PATH}`]: () =>
        fail ? problem(500, 'internal_error') : json({ items: [SAVED] }),
    });
    renderApp('/o/acme/p/WEB/issues');
    const menu = await openMenu();
    expect(await within(menu).findByText(/Could not load your saved filters/)).toBeInTheDocument();
    fail = false;
    await userEvent.click(within(menu).getByRole('button', { name: 'Try again' }));
    expect(await within(menu).findByRole('button', { name: 'My open bugs' })).toBeInTheDocument();
  });
});
