import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { Board, Issue } from '../../lib/api/types';
import { json, mockApi, problem, renderApp, SIGNED_IN } from '../../test/api';

import { allowedColumnIds, applyMove, planMove } from './boardState';

const TODO = 's-todo';
const DOING = 's-doing';
const DONE = 's-done';

function card(key: string, statusId: string, version = 1): Issue {
  return {
    id: `id-${key}`,
    key,
    project_key: 'WEB',
    summary: `Summary ${key}`,
    description: null,
    type: { id: 't', name: 'Task', kind: 'standard' },
    status: { id: statusId, name: statusId, category: 'todo' },
    priority: { id: 'p', name: 'Medium', color: '#888888' },
    reporter: { id: 'u', display_name: 'Ann' },
    assignee: null,
    parent: null,
    labels: [],
    version,
    created_at: '2026-10-28T00:00:00Z',
    updated_at: '2026-10-28T00:00:00Z',
  };
}

function board(): Board {
  const column = (
    id: string,
    name: string,
    statusId: string,
    issues: Issue[],
    wip: number | null,
  ) => ({
    id,
    name,
    position: 0,
    wip_limit: wip,
    status_ids: [statusId],
    count: issues.length,
    over_wip_limit: wip !== null && issues.length > wip,
    issues,
  });
  return {
    project_key: 'WEB',
    board_type: 'kanban',
    truncated: false,
    columns: [
      column('c1', 'To Do', TODO, [card('WEB-1', TODO), card('WEB-2', TODO)], 1),
      column('c2', 'Doing', DOING, [card('WEB-3', DOING)], null),
      column('c3', 'Done', DONE, [], null),
    ],
    transitions: [
      { from_status_id: TODO, to_status_id: DOING },
      { from_status_id: DOING, to_status_id: DONE },
    ],
  };
}

describe('board state', () => {
  it('computes drop targets from the workflow transitions', () => {
    const b = board();
    const todoCard = b.columns[0]?.issues[0] as Issue;
    expect([...allowedColumnIds(b, todoCard)].sort()).toEqual(['c1', 'c2']);
  });

  it('plans neighbours for a reorder and for a cross-column move', () => {
    const b = board();
    expect(planMove(b, 'WEB-2', 'c1', 0)).toEqual({
      toStatusId: TODO,
      statusChanged: false,
      afterKey: null,
      beforeKey: 'WEB-1',
    });
    expect(planMove(b, 'WEB-1', 'c2', 1)).toEqual({
      toStatusId: DOING,
      statusChanged: true,
      afterKey: 'WEB-3',
      beforeKey: null,
    });
    expect(planMove(b, 'WEB-1', 'c3', 0)).toBeNull();
  });

  it('applies a move optimistically without mutating the input and updates WIP counts', () => {
    const b = board();
    const next = applyMove(b, 'WEB-1', 'c2', 0);
    expect(b.columns[0]?.issues).toHaveLength(2);
    expect(next.columns[0]?.issues.map((c) => c.key)).toEqual(['WEB-2']);
    expect(next.columns[0]?.over_wip_limit).toBe(false);
    expect(next.columns[1]?.issues.map((c) => c.key)).toEqual(['WEB-1', 'WEB-3']);
    expect(applyMove(b, 'WEB-1', 'c3', 0)).toBe(b);
  });
});

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
  permissions: ['issue.transition', 'project.view'],
  created_at: '2026-10-27T00:00:00Z',
};

describe('board page', () => {
  it('shows columns, WIP state and moves a card through the menu with If-Match', async () => {
    let current = board();
    const calls = mockApi({
      'GET /auth/session': () => json(SESSION),
      'GET /orgs/acme/projects/WEB': () => json(PROJECT),
      'GET /orgs/acme/projects/WEB/board': () => json(current),
      'POST /orgs/acme/issues/WEB-1/move': () => {
        current = {
          ...current,
          columns: current.columns.map((c, i) => ({
            ...c,
            issues:
              i === 0
                ? c.issues.slice(1)
                : i === 1
                  ? [...c.issues, card('WEB-1', DOING, 2)]
                  : c.issues,
          })),
        };
        return json(card('WEB-1', DOING, 2));
      },
    });
    renderApp('/o/acme/p/WEB/board');
    expect(await screen.findByRole('heading', { name: 'WEB board' })).toBeInTheDocument();
    expect(screen.getByText(/over WIP limit/)).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Move WEB-1 to'), 'Doing');
    await waitFor(() => {
      expect(calls.some((c) => c.method === 'POST')).toBe(true);
    });
    const post = calls.find((c) => c.method === 'POST');
    expect(post?.headers.get('If-Match')).toBe('"v1"');
    expect(post?.body).toEqual({ to_status_id: DOING, after_key: 'WEB-3' });
    const doing = screen.getByRole('region', { name: /Doing/ });
    await waitFor(() => {
      expect(within(doing).getByText('WEB-1')).toBeInTheDocument();
    });
  });

  it('rolls the board back and shows an error when the server rejects the move', async () => {
    mockApi({
      'GET /auth/session': () => json(SESSION),
      'GET /orgs/acme/projects/WEB': () => json(PROJECT),
      'GET /orgs/acme/projects/WEB/board': () => json(board()),
      'POST /orgs/acme/issues/WEB-1/move': () => problem(412, 'version_conflict'),
    });
    renderApp('/o/acme/p/WEB/board');
    await screen.findByRole('heading', { name: 'WEB board' });
    await userEvent.selectOptions(screen.getByLabelText('Move WEB-1 to'), 'Doing');
    expect(await screen.findByRole('alert')).toHaveTextContent('The board was restored');
    const todo = screen.getByRole('region', { name: /To Do/ });
    expect(within(todo).getByText('WEB-1')).toBeInTheDocument();
  });

  it('offers no move controls without the transition permission', async () => {
    mockApi({
      'GET /auth/session': () => json(SESSION),
      'GET /orgs/acme/projects/WEB': () => json({ ...PROJECT, permissions: ['project.view'] }),
      'GET /orgs/acme/projects/WEB/board': () => json(board()),
    });
    renderApp('/o/acme/p/WEB/board');
    await screen.findByRole('heading', { name: 'WEB board' });
    expect(screen.queryByLabelText('Move WEB-1 to')).not.toBeInTheDocument();
  });
});
