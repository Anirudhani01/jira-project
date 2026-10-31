import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { areShortcutsEnabled, setShortcutsEnabled } from '../../lib/keyboard';
import { json, mockApi, renderApp, SIGNED_IN } from '../../test/api';

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
  board_type: 'kanban' as const,
  archived: false,
  my_role: 'member',
  permissions: ['project.view', 'issue.create'],
  created_at: '2026-10-27T00:00:00Z',
};
const ORG = {
  id: '1',
  slug: 'acme',
  name: 'Acme',
  role: 'member',
  permissions: ['org.view'],
  created_at: '2026-10-27T00:00:00Z',
};
const HIT = {
  id: 'i-1',
  key: 'WEB-7',
  project_key: 'WEB',
  summary: 'Login button misaligned',
  description: null,
  type: { id: 't', name: 'Task', kind: 'standard' },
  status: { id: 's', name: 'To Do', category: 'todo' },
  priority: { id: 'p', name: 'Medium', color: '#888' },
  reporter: { id: 'u', display_name: 'Ann' },
  assignee: null,
  parent: null,
  labels: [],
  sprint: null,
  story_points: null,
  fix_version: null,
  version: 1,
  created_at: '2026-10-28T00:00:00Z',
  updated_at: '2026-10-28T00:00:00Z',
};

function mount() {
  return mockApi({
    'GET /auth/session': () => json(SESSION),
    'GET /orgs/acme': () => json(ORG),
    'GET /orgs/acme/notifications/unread-count': () => json({ count: 0 }),
    'GET /orgs/acme/projects': () =>
      json({
        items: [
          { key: 'WEB', name: 'Website', board_type: 'kanban', archived: false, my_role: 'member' },
        ],
      }),
    'GET /orgs/acme/projects/WEB': () => json(PROJECT),
    'GET /orgs/acme/projects/WEB/board': () =>
      json({
        project_key: 'WEB',
        board_type: 'kanban',
        truncated: false,
        sprint: null,
        columns: [],
        transitions: [],
      }),
    'GET /orgs/acme/issue-types': () =>
      json({ items: [{ id: 't1', name: 'Task', kind: 'standard', position: 1 }] }),
    'GET /orgs/acme/priorities': () =>
      json({ items: [{ id: 'p1', name: 'Medium', sort_order: 2, color: '#888888' }] }),
    'GET /orgs/acme/projects/WEB/members': () => json({ items: [] }),
    'GET /orgs/acme/projects/WEB/labels': () => json({ items: [] }),
    'GET /orgs/acme/projects/WEB/versions': () => json({ items: [] }),
    'GET /orgs/acme/issues': () => json({ items: [HIT], next_cursor: null }),
  });
}

afterEach(() => {
  setShortcutsEnabled(true);
});

describe('shortcut help', () => {
  it('opens with ? and the Help button, lists the documented keys and can switch shortcuts off', async () => {
    mount();
    renderApp('/o/acme/p/WEB/board');
    const user = userEvent.setup();
    await screen.findByRole('navigation', { name: 'Project' });
    await user.keyboard('?');
    const dialog = await screen.findByRole('dialog', { name: 'Keyboard shortcuts' });
    expect(within(dialog).getByText('Create an issue')).toBeInTheDocument();
    expect(within(dialog).getByText('G then B')).toBeInTheDocument();
    expect(within(dialog).getByText('Ctrl/⌘ + K')).toBeInTheDocument();
    await user.click(
      within(dialog).getByRole('checkbox', { name: 'Keyboard shortcuts are enabled' }),
    );
    expect(areShortcutsEnabled()).toBe(false);
    await user.click(within(dialog).getByRole('button', { name: 'Done' }));
    await user.keyboard('c');
    expect(screen.queryByRole('dialog', { name: 'Create issue' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Keyboard shortcuts' }));
    await user.click(
      within(await screen.findByRole('dialog', { name: 'Keyboard shortcuts' })).getByRole(
        'checkbox',
      ),
    );
    expect(areShortcutsEnabled()).toBe(true);
  });
});

describe('single-key shortcuts', () => {
  it('C opens the create dialog in a project, and says what is missing outside one', async () => {
    mount();
    renderApp('/o/acme/p/WEB/board');
    const user = userEvent.setup();
    await screen.findByRole('navigation', { name: 'Project' });
    await user.keyboard('c');
    expect(await screen.findByRole('dialog', { name: 'Create issue' })).toBeInTheDocument();
  });

  it('G then B/L/I/H navigates, shows a hint while waiting, and an unknown key cancels', async () => {
    mount();
    const { router } = renderApp('/o/acme/p/WEB/board');
    const user = userEvent.setup();
    await screen.findByRole('navigation', { name: 'Project' });
    await user.keyboard('g');
    expect(await screen.findByText(/Go to: H for you/)).toBeInTheDocument();
    await user.keyboard('i');
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/o/acme/p/WEB/issues');
    });
    await user.keyboard('gh');
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/o/acme');
    });
    await user.keyboard('gz');
    expect(router.state.location.pathname).toBe('/o/acme');
    await user.keyboard('gl');
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/o/acme/p/WEB/backlog');
    });
  });

  it('slash focuses the global search; keys are ignored while typing and while a dialog is open', async () => {
    mount();
    renderApp('/o/acme/p/WEB/board');
    const user = userEvent.setup();
    await screen.findByRole('navigation', { name: 'Project' });
    const search = await screen.findByRole('combobox', { name: /search issues and projects/i });
    await user.keyboard('/');
    expect(search).toHaveFocus();
    await user.keyboard('c');
    expect(search).toHaveValue('c');
    expect(screen.queryByRole('dialog', { name: 'Create issue' })).toBeNull();
    await user.clear(search);
    await user.tab();
    await user.keyboard('?');
    const help = await screen.findByRole('dialog', { name: 'Keyboard shortcuts' });
    await user.keyboard('c');
    expect(screen.queryByRole('dialog', { name: 'Create issue' })).toBeNull();
    expect(help).toBeInTheDocument();
  });
});

describe('command palette', () => {
  it('opens with Ctrl+K, filters actions, runs one with Enter and closes with Escape', async () => {
    mount();
    const { router } = renderApp('/o/acme/p/WEB/board');
    const user = userEvent.setup();
    await screen.findByRole('navigation', { name: 'Project' });
    await user.keyboard('{Control>}k{/Control}');
    const dialog = await screen.findByRole('dialog', { name: 'Command palette' });
    const input = within(dialog).getByRole('combobox');
    expect(within(dialog).getByText('Create issue')).toBeInTheDocument();
    await user.type(input, 'issue list');
    expect(within(dialog).queryByText('Go to board')).toBeNull();
    await user.keyboard('{Enter}');
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/o/acme/p/WEB/issues');
    });
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).toBeNull();

    await user.keyboard('{Control>}k{/Control}');
    await screen.findByRole('dialog', { name: 'Command palette' });
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Command palette' })).toBeNull();
    });
  });

  it('searches issues by text and opens the chosen one; a leading / limits it to issues', async () => {
    const calls = mount();
    const { router } = renderApp('/o/acme/p/WEB/board');
    const user = userEvent.setup();
    await screen.findByRole('navigation', { name: 'Project' });
    await user.keyboard('{Control>}k{/Control}');
    const dialog = await screen.findByRole('dialog', { name: 'Command palette' });
    await user.type(within(dialog).getByRole('combobox'), '/login');
    expect(await within(dialog).findByText('Login button misaligned')).toBeInTheDocument();
    expect(within(dialog).queryByText('Go to board')).toBeNull();
    expect(calls.some((c) => c.path === '/orgs/acme/issues' && c.search.includes('q=login'))).toBe(
      true,
    );
    await user.click(within(dialog).getByText('Login button misaligned'));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/o/acme/issues/WEB-7');
    });
  });

  it('says so when nothing matches and keeps the typed text', async () => {
    mount();
    renderApp('/o/acme/p/WEB/board');
    const user = userEvent.setup();
    await screen.findByRole('navigation', { name: 'Project' });
    await user.keyboard('{Control>}k{/Control}');
    const dialog = await screen.findByRole('dialog', { name: 'Command palette' });
    await user.type(within(dialog).getByRole('combobox'), 'zzzqqq');
    expect(await within(dialog).findByText(/Nothing matches/)).toBeInTheDocument();
    expect(within(dialog).getByRole('combobox')).toHaveValue('zzzqqq');
  });

  it('does not open while typing in a field', async () => {
    mount();
    renderApp('/o/acme/p/WEB/board');
    const user = userEvent.setup();
    const search = await screen.findByRole('combobox', { name: /search issues and projects/i });
    await user.click(search);
    await user.keyboard('{Control>}k{/Control}');
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).toBeNull();
  });
});
