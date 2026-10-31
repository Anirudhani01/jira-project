import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { json, mockApi, renderApp, SIGNED_IN } from '../../test/api';

import { SIDEBAR_COLLAPSED_KEY } from './storage';

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
  permissions: ['project.view'],
  created_at: '2026-10-27T00:00:00Z',
};
const BOARD = {
  project_key: 'WEB',
  board_type: 'kanban',
  truncated: false,
  sprint: null,
  columns: [],
  transitions: [],
};
const ORG = {
  id: '1',
  slug: 'acme',
  name: 'Acme',
  role: 'member',
  permissions: ['org.view', 'project.create'],
  created_at: '2026-10-27T00:00:00Z',
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
    'GET /orgs/acme/projects/WEB/board': () => json(BOARD),
  });
}

describe('navigation v2', () => {
  it('lists the sections in the reference order inside the global sidebar', async () => {
    mount();
    renderApp('/o/acme');
    const nav = await screen.findByRole('navigation', { name: 'Global' });
    const titles = within(nav)
      .getAllByText(/^(Recent|Starred|Projects|More)$/)
      .map((node) => node.textContent);
    expect(titles).toEqual(['Recent', 'Starred', 'Projects', 'More']);
    expect(within(nav).getByRole('link', { name: 'For you' })).toBeInTheDocument();
    expect(await within(nav).findByRole('link', { name: /Website/ })).toHaveAttribute(
      'href',
      '/o/acme/p/WEB/board',
    );
    expect(within(nav).getByRole('link', { name: 'Create project' })).toBeInTheDocument();
  });

  it('records visited projects in Recent', async () => {
    mount();
    renderApp('/o/acme/p/WEB/board');
    const nav = await screen.findByRole('navigation', { name: 'Global' });
    expect(await within(nav).findByRole('link', { name: 'WEB' })).toHaveAttribute(
      'href',
      '/o/acme/p/WEB/board',
    );
  });

  it('stars a project from its header and lists it under Starred, per user', async () => {
    mount();
    renderApp('/o/acme/p/WEB/board');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Star Website' }));
    expect(screen.getByRole('button', { name: 'Unstar Website' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    const stored = Object.entries(localStorage).find(([key]) => key.endsWith('.starred'));
    expect(stored?.[0]).toContain(SESSION.user.id);
    expect(JSON.parse(stored?.[1] ?? '[]') as unknown).toEqual([{ key: 'WEB', name: 'Website' }]);
    await user.click(screen.getByRole('button', { name: 'Unstar Website' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Star Website' })).toBeInTheDocument();
    });
  });

  it('hides sections the user turns off in Customize sidebar', async () => {
    mount();
    renderApp('/o/acme');
    const user = userEvent.setup();
    const nav = await screen.findByRole('navigation', { name: 'Global' });
    expect(within(nav).getByText('Recent')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Customize sidebar' }));
    const dialog = await screen.findByRole('dialog', { name: 'Customize sidebar' });
    await user.click(within(dialog).getByRole('checkbox', { name: 'Recent' }));
    await user.click(within(dialog).getByRole('button', { name: 'Done' }));
    await waitFor(() => {
      expect(within(nav).queryByText('Recent')).toBeNull();
    });
  });

  it('collapses with Ctrl+[ and remembers it', async () => {
    mount();
    renderApp('/o/acme');
    const user = userEvent.setup();
    await screen.findByRole('button', { name: 'Collapse sidebar' });
    await user.keyboard('{Control>}[[{/Control}');
    expect(await screen.findByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument();
    expect(localStorage.getItem(SIDEBAR_COLLAPSED_KEY)).toBe('1');
    await user.keyboard('{Control>}[[{/Control}');
    expect(await screen.findByRole('button', { name: 'Collapse sidebar' })).toBeInTheDocument();
  });

  it('puts project settings in the More actions menu, not in the tabs', async () => {
    mount();
    renderApp('/o/acme/p/WEB/board');
    const user = userEvent.setup();
    const tabs = await screen.findByRole('navigation', { name: 'Project' });
    expect(within(tabs).queryByRole('link', { name: 'Settings' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    expect(await screen.findByRole('menuitem', { name: /Project settings/ })).toHaveAttribute(
      'href',
      '/o/acme/p/WEB',
    );
  });
});
