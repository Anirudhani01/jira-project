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
  'GET /orgs/acme/issues/WEB-1/children': () => json({ items: [], done: 0, total: 0 }),
};

afterEach(() => {
  vi.unstubAllGlobals();
});

function activityEntry(
  id: number,
  created_at: string,
  overrides: Partial<{
    action: string;
    field: string | null;
    actor: { id: string; display_name: string } | null;
  }> = {},
) {
  return {
    id,
    actor: overrides.actor ?? { id: SIGNED_IN.user.id, display_name: 'Ann Example' },
    action: overrides.action ?? 'updated',
    field: overrides.field ?? 'status',
    old_value: 'To Do',
    new_value: 'In Progress',
    created_at,
  };
}

function deferredResponse() {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

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

describe('activity timeline', () => {
  it('merges comments and activity into one chronologically ordered timeline', async () => {
    mockApi({
      ...CONFIG,
      'GET /orgs/acme/issues/WEB-1/activity': () =>
        json({
          items: [
            activityEntry(1, '2026-10-28T00:30:00Z', { action: 'created', field: null }),
            activityEntry(2, '2026-10-28T02:30:00Z'),
          ],
          next_cursor: null,
        }),
      'GET /orgs/acme/issues/WEB-1/comments': () =>
        json({ items: [MINE, THEIRS], next_cursor: null }),
    });
    renderApp('/o/acme/issues/WEB-1');
    await screen.findByText('My own comment');
    const rows = await screen.findAllByRole('listitem');
    const texts = rows.map((row) => row.textContent);
    expect(texts).toHaveLength(4);
    expect(texts[0]).toMatch(/created/);
    expect(texts[1]).toMatch(/My own comment/);
    expect(texts[2]).toMatch(/Someone else's comment/);
    expect(texts[3]).toMatch(/changed status/);
  });

  it('breaks an exact-timestamp tie by rendering the activity entry before the comment', async () => {
    const SAME = '2026-10-28T01:00:00Z';
    mockApi({
      ...CONFIG,
      'GET /orgs/acme/issues/WEB-1/activity': () =>
        json({ items: [activityEntry(1, SAME)], next_cursor: null }),
      'GET /orgs/acme/issues/WEB-1/comments': () =>
        json({ items: [{ ...MINE, created_at: SAME }], next_cursor: null }),
    });
    renderApp('/o/acme/issues/WEB-1');
    const rows = await screen.findAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toMatch(/changed status/);
    expect(rows[1]?.textContent).toMatch(/My own comment/);
  });

  it('paginates activity independently of comments via "Load more history", with no duplicates', async () => {
    const nextCursor = 'dGhlLWFjdGl2aXR5LWN1cnNvcg'; // opaque token like the real API (base64 id)
    const calls = mockApi({
      ...CONFIG,
      'GET /orgs/acme/issues/WEB-1/activity': (call) => {
        const cursor = new URLSearchParams(
          call.search.startsWith('?') ? call.search.slice(1) : call.search,
        ).get('cursor');
        if (cursor === null) {
          return json({
            items: [activityEntry(1, '2026-10-28T00:30:00Z', { action: 'created', field: null })],
            next_cursor: nextCursor,
          });
        }
        if (cursor !== nextCursor) {
          return problem(400, 'invalid_cursor');
        }
        return json({ items: [activityEntry(2, '2026-10-28T03:00:00Z')], next_cursor: null });
      },
      'GET /orgs/acme/issues/WEB-1/comments': () => json({ items: [MINE], next_cursor: null }), // created_at 01:00, no further comment pages
    });
    renderApp('/o/acme/issues/WEB-1');
    await screen.findByText('My own comment');
    expect(screen.getAllByRole('listitem')).toHaveLength(2); // one activity entry + one comment
    expect(screen.queryByRole('button', { name: 'Load more comments' })).not.toBeInTheDocument();

    const activityGets = () =>
      calls.filter((c) => c.method === 'GET' && c.path === '/orgs/acme/issues/WEB-1/activity');
    expect(activityGets()).toHaveLength(1);
    expect(new URLSearchParams(activityGets()[0]?.search.slice(1) ?? '').get('cursor')).toBeNull();

    const loadMore = screen.getByRole('button', { name: 'Load more history' });
    await userEvent.click(loadMore);

    await waitFor(() => {
      expect(activityGets()).toHaveLength(2);
    });
    expect(new URLSearchParams(activityGets()[1]?.search.slice(1) ?? '').get('cursor')).toBe(
      nextCursor,
    );

    const rows = await screen.findAllByRole('listitem');
    expect(rows).toHaveLength(3);
    // No duplicate of the first activity page's entry; the second page's entry is present
    // exactly once, ordered after the comment (03:00 > 01:00).
    expect(rows.filter((r) => /created/.test(r.textContent))).toHaveLength(1);
    expect(rows[2]?.textContent).toMatch(/changed status/);
    expect(screen.queryByRole('button', { name: 'Load more history' })).not.toBeInTheDocument();
  });

  it('shows a loading state while activity is in flight and clears it once resolved', async () => {
    const pending = deferredResponse();
    mockApi({
      ...CONFIG,
      'GET /orgs/acme/issues/WEB-1/activity': () => pending.promise,
      'GET /orgs/acme/issues/WEB-1/comments': () => json({ items: [], next_cursor: null }),
    });
    renderApp('/o/acme/issues/WEB-1');
    expect(await screen.findByText(/Loading activity/)).toBeInTheDocument();
    pending.resolve(json({ items: [], next_cursor: null }));
    await waitFor(() => {
      expect(screen.queryByText(/Loading activity/)).not.toBeInTheDocument();
    });
  });

  it('shows a retryable error state when the activity request fails, independent of comments', async () => {
    mockApi({
      ...CONFIG,
      'GET /orgs/acme/issues/WEB-1/activity': () =>
        new Response(JSON.stringify({ status: 500, code: 'internal_error' }), { status: 500 }),
      'GET /orgs/acme/issues/WEB-1/comments': () => json({ items: [MINE], next_cursor: null }),
    });
    renderApp('/o/acme/issues/WEB-1');
    expect(await screen.findByText('My own comment')).toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('does not duplicate the first page when a comment edit invalidates and refetches the comments list', async () => {
    let commentCalls = 0;
    mockApi({
      ...CONFIG,
      'GET /orgs/acme/issues/WEB-1/activity': () =>
        json({
          items: [activityEntry(1, '2026-10-28T00:30:00Z', { action: 'created', field: null })],
          next_cursor: null,
        }),
      'GET /orgs/acme/issues/WEB-1/comments': () => {
        commentCalls += 1;
        // Same page re-fetched after the edit invalidates the query -- the body changes,
        // the id doesn't, exactly like a real server response would look.
        const body = commentCalls === 1 ? 'My own comment' : 'Updated';
        return json({ items: [{ ...MINE, body, body_html: `<p>${body}</p>` }], next_cursor: null });
      },
      'PATCH /orgs/acme/comments/c-mine': () =>
        json({ ...MINE, body: 'Updated', body_html: '<p>Updated</p>' }),
    });
    renderApp('/o/acme/issues/WEB-1');
    await screen.findByText('My own comment');
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    await userEvent.clear(screen.getByLabelText('Edit comment'));
    await userEvent.type(screen.getByLabelText('Edit comment'), 'Updated');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Updated');
    await waitFor(() => {
      expect(commentCalls).toBeGreaterThanOrEqual(2);
    });
    // Exactly one row for the comment id, never a stale copy alongside the refetched one.
    expect(screen.queryByText('My own comment')).not.toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2); // the one activity entry + one comment
  });
});
