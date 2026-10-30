import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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
  board_type: 'kanban',
  archived: false,
  my_role: 'member',
  permissions: ['issue.create', 'issue.edit', 'project.view'],
  created_at: '2026-10-27T00:00:00Z',
};
const LABEL = { id: 'lbl-1', name: 'Bug', color: '#ff0000' };
const ISSUE = {
  id: '55555555-5555-5555-5555-555555555555',
  key: 'WEB-1',
  project_key: 'WEB',
  summary: 'Login button misaligned',
  description: 'Details here',
  type: { id: 't-task', name: 'Task', kind: 'standard' },
  status: { id: 's1', name: 'To Do', category: 'todo' },
  priority: { id: 'p-med', name: 'Medium', color: '#888888' },
  reporter: { id: SIGNED_IN.user.id, display_name: 'Ann Example' },
  assignee: null,
  parent: null,
  labels: [],
  version: 3,
  created_at: '2026-10-28T00:00:00Z',
  updated_at: '2026-10-28T00:00:00Z',
};

const DETAIL_HANDLERS = {
  'GET /auth/session': () => json(SESSION),
  'GET /orgs/acme/projects/WEB': () => json(PROJECT),
  'GET /orgs/acme/issue-types': () => json({ items: [] }),
  'GET /orgs/acme/priorities': () => json({ items: [] }),
  'GET /orgs/acme/projects/WEB/members': () => json({ items: [] }),
  'GET /orgs/acme/projects/WEB/labels': () => json({ items: [LABEL] }),
  'GET /orgs/acme/issues/WEB-1': () => json(ISSUE),
  'GET /orgs/acme/issues/WEB-1/children': () => json({ items: [], done: 0, total: 0 }),
  'GET /orgs/acme/issues/WEB-1/activity': () => json({ items: [], next_cursor: null }),
};

const OFFLINE_HINT = /Reconnect to save changes to the server/i;

function setNavigatorOnline(online: boolean) {
  act(() => {
    Object.defineProperty(window.navigator, 'onLine', { value: online, configurable: true });
    window.dispatchEvent(new Event(online ? 'online' : 'offline'));
  });
}

beforeEach(() => {
  setNavigatorOnline(true);
});

afterEach(() => {
  setNavigatorOnline(true);
  vi.unstubAllGlobals();
});

describe('IssueDetailPage offline save', () => {
  it('disables summary Save with explanation while offline', async () => {
    mockApi(DETAIL_HANDLERS);
    renderApp('/o/acme/issues/WEB-1');
    await screen.findByRole('heading', { name: 'Login button misaligned' });
    setNavigatorOnline(false);
    await userEvent.click(screen.getByRole('button', { name: 'Edit summary' }));
    expect(await screen.findByText(OFFLINE_HINT)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    setNavigatorOnline(true);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    });
  });

  it('disables description Save with explanation while offline', async () => {
    mockApi(DETAIL_HANDLERS);
    renderApp('/o/acme/issues/WEB-1');
    await screen.findByRole('heading', { name: 'Login button misaligned' });
    setNavigatorOnline(false);
    await userEvent.click(screen.getByRole('button', { name: 'Edit description' }));
    const save = await screen.findByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
    expect(screen.getByText(OFFLINE_HINT)).toBeInTheDocument();
  });

  it('disables label Save with explanation while offline', async () => {
    mockApi(DETAIL_HANDLERS);
    renderApp('/o/acme/issues/WEB-1');
    await screen.findByRole('heading', { name: 'Login button misaligned' });
    setNavigatorOnline(false);
    await userEvent.click(screen.getByRole('button', { name: 'Edit labels' }));
    const card = screen.getByRole('heading', { name: 'Labels' }).closest('.space-y-3');
    const scope = card?.parentElement ?? document.body;
    expect(within(scope).getByText(OFFLINE_HINT)).toBeInTheDocument();
    expect(within(scope).getByRole('button', { name: 'Save' })).toBeDisabled();
  });
});
