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
const TASK = { id: 't-task', name: 'Task', kind: 'standard', position: 2 };
const SUBTASK = { id: 't-sub', name: 'Sub-task', kind: 'subtask', position: 4 };
const MEDIUM = { id: 'p-med', name: 'Medium', sort_order: 2, color: '#888888' };
const HIGH = { id: 'p-high', name: 'High', sort_order: 1, color: '#ff0000' };
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
  version: 3,
  created_at: '2026-10-28T00:00:00Z',
  updated_at: '2026-10-28T00:00:00Z',
};
const CONFIG = {
  'GET /auth/session': () => json(SESSION),
  'GET /orgs/acme/projects/WEB': () => json(PROJECT),
  'GET /orgs/acme/issue-types': () => json({ items: [TASK, SUBTASK] }),
  'GET /orgs/acme/priorities': () => json({ items: [HIGH, MEDIUM] }),
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('issue list', () => {
  it('lists issues and creates one with an Idempotency-Key, never offering sub-tasks', async () => {
    const calls = mockApi({
      ...CONFIG,
      'GET /orgs/acme/issues': () => json({ items: [ISSUE], next_cursor: null }),
      'POST /orgs/acme/projects/WEB/issues': () => json({ ...ISSUE, key: 'WEB-2' }, 201),
      'GET /orgs/acme/issues/WEB-2': () => json({ ...ISSUE, key: 'WEB-2' }),
      'GET /orgs/acme/issues/WEB-2/activity': () => json({ items: [], next_cursor: null }),
    });
    renderApp('/o/acme/p/WEB/issues');
    expect(await screen.findByText('Login button misaligned')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Create issue' }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => {
      expect(within(dialog).getByRole('option', { name: 'Task' })).toBeInTheDocument();
    });
    expect(within(dialog).queryByRole('option', { name: 'Sub-task' })).not.toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText('Summary'), 'New issue');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    await waitFor(() => {
      expect(calls.some((c) => c.method === 'POST')).toBe(true);
    });
    const post = calls.find((c) => c.method === 'POST');
    expect(post?.headers.get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/);
    expect(post?.body).toEqual({ type_id: TASK.id, priority_id: MEDIUM.id, summary: 'New issue' });
  });

  it('hides creation without the permission', async () => {
    mockApi({
      ...CONFIG,
      'GET /orgs/acme/projects/WEB': () => json({ ...PROJECT, permissions: ['project.view'] }),
      'GET /orgs/acme/issues': () => json({ items: [], next_cursor: null }),
    });
    renderApp('/o/acme/p/WEB/issues');
    expect(await screen.findByText('No issues match these filters.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create issue' })).not.toBeInTheDocument();
  });
});

describe('issue detail', () => {
  it('sends If-Match and keeps the draft with a reload banner on 412', async () => {
    const calls = mockApi({
      ...CONFIG,
      'GET /orgs/acme/issues/WEB-1': () => json(ISSUE),
      'GET /orgs/acme/issues/WEB-1/activity': () =>
        json({
          items: [
            {
              id: 1,
              actor: ISSUE.reporter,
              action: 'created',
              field: null,
              old_value: null,
              new_value: null,
              created_at: ISSUE.created_at,
            },
          ],
          next_cursor: null,
        }),
      'PATCH /orgs/acme/issues/WEB-1': () => problem(412, 'version_conflict'),
    });
    renderApp('/o/acme/issues/WEB-1');
    await userEvent.click(await screen.findByRole('button', { name: 'Edit summary' }));
    const input = screen.getByLabelText('Summary');
    await userEvent.clear(input);
    await userEvent.type(input, 'My edit');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/Someone else changed this issue/)).toBeInTheDocument();
    expect(screen.getByLabelText('Summary')).toHaveValue('My edit');
    const patch = calls.find((c) => c.method === 'PATCH');
    expect(patch?.headers.get('If-Match')).toBe('"v3"');
    expect(patch?.body).toEqual({ summary: 'My edit' });
    expect(screen.getByRole('button', { name: 'Reload latest version' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete issue' })).not.toBeInTheDocument();
  });

  it('shows the not-found page for inaccessible issues', async () => {
    mockApi({ ...CONFIG, 'GET /orgs/acme/issues/WEB-9': () => problem(404, 'not_found') });
    renderApp('/o/acme/issues/WEB-9');
    expect(await screen.findByRole('heading', { name: /not found/i })).toBeInTheDocument();
  });
});
