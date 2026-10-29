import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

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
  my_role: 'admin',
  permissions: ['comment.create', 'comment.delete_any', 'issue.edit', 'project.view'],
  created_at: '2026-10-27T00:00:00Z',
};
const TASK = { id: 't-task', name: 'Task', kind: 'standard', position: 2 };
const MEDIUM = { id: 'p-med', name: 'Medium', sort_order: 2, color: '#888888' };
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
const MINE = {
  id: 'c-mine',
  issue_key: 'WEB-1',
  author: { id: SIGNED_IN.user.id, display_name: 'Ann Example' },
  body: 'My own comment',
  body_html: '<p>My own comment</p>',
  edited_at: null,
  created_at: '2026-10-28T01:00:00Z',
  updated_at: '2026-10-28T01:00:00Z',
};
const THEIRS = {
  id: 'c-theirs',
  issue_key: 'WEB-1',
  author: { id: 'other-user', display_name: 'Bea Example' },
  body: "Someone else's comment",
  body_html: "<p>Someone else's comment</p>",
  edited_at: null,
  created_at: '2026-10-28T02:00:00Z',
  updated_at: '2026-10-28T02:00:00Z',
};
const CONFIG = {
  'GET /auth/session': () => json(SESSION),
  'GET /orgs/acme/projects/WEB': () => json(PROJECT),
  'GET /orgs/acme/projects/WEB/members': () => json({ items: [] }),
  'GET /orgs/acme/projects/WEB/labels': () => json({ items: [] }),
  'GET /orgs/acme/issue-types': () => json({ items: [TASK] }),
  'GET /orgs/acme/priorities': () => json({ items: [MEDIUM] }),
  'GET /orgs/acme/issues/WEB-1': () => json(ISSUE),
  'GET /orgs/acme/issues/WEB-1/activity': () => json({ items: [], next_cursor: null }),
  'GET /orgs/acme/issues/WEB-1/transitions': () => json({ items: [] }),
  'GET /orgs/acme/issues/WEB-1/children': () => json({ items: [] }),
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('comments', () => {
  it('lists comments merged with activity and posts a new one with an Idempotency-Key', async () => {
    const calls = mockApi({
      ...CONFIG,
      'GET /orgs/acme/issues/WEB-1/comments': () => json({ items: [MINE], next_cursor: null }),
      'POST /orgs/acme/issues/WEB-1/comments': () =>
        json({ ...MINE, id: 'c-new', body: 'New comment', body_html: '<p>New comment</p>' }, 201),
    });
    renderApp('/o/acme/issues/WEB-1');
    expect(await screen.findByText('My own comment')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Add a comment'), 'New comment');
    await userEvent.click(screen.getByRole('button', { name: 'Comment' }));
    await waitFor(() => {
      expect(calls.some((c) => c.method === 'POST' && c.path.endsWith('/comments'))).toBe(true);
    });
    const post = calls.find((c) => c.method === 'POST');
    expect(post?.headers.get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/);
    expect(post?.body).toEqual({ body: 'New comment' });
  });

  it("lets the author edit their own comment but offers no edit for someone else's", async () => {
    const calls = mockApi({
      ...CONFIG,
      'GET /orgs/acme/issues/WEB-1/comments': () =>
        json({ items: [MINE, THEIRS], next_cursor: null }),
      'PATCH /orgs/acme/comments/c-mine': () =>
        json({
          ...MINE,
          body: 'Updated',
          body_html: '<p>Updated</p>',
          edited_at: '2026-10-28T03:00:00Z',
        }),
    });
    renderApp('/o/acme/issues/WEB-1');
    await screen.findByText('My own comment');
    const mineItem = screen.getByText('My own comment').closest('li');
    const theirsItem = screen.getByText("Someone else's comment").closest('li');
    if (mineItem === null || theirsItem === null) throw new Error('comment item not found');
    expect(within(mineItem).getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(within(theirsItem).queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();

    await userEvent.click(within(mineItem).getByRole('button', { name: 'Edit' }));
    const textarea = screen.getByLabelText('Edit comment');
    await userEvent.clear(textarea);
    await userEvent.type(textarea, 'Updated');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(calls.some((c) => c.method === 'PATCH')).toBe(true);
    });
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ body: 'Updated' });
  });

  it("lets a comment.delete_any holder delete someone else's comment", async () => {
    const calls = mockApi({
      ...CONFIG,
      'GET /orgs/acme/issues/WEB-1/comments': () => json({ items: [THEIRS], next_cursor: null }),
      'DELETE /orgs/acme/comments/c-theirs': () => new Response(null, { status: 204 }),
    });
    vi.stubGlobal('confirm', () => true);
    renderApp('/o/acme/issues/WEB-1');
    await screen.findByText("Someone else's comment");
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => {
      expect(calls.some((c) => c.method === 'DELETE')).toBe(true);
    });
  });
});
