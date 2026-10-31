import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { Backlog, Issue, Sprint } from '../../lib/api/types';
import { json, mockApi, problem, renderApp, SIGNED_IN } from '../../test/api';

function issue(key: string, sprint: Issue['sprint'] = null, version = 1): Issue {
  return {
    id: `id-${key}`,
    key,
    project_key: 'SCR',
    summary: `Summary ${key}`,
    description: null,
    type: { id: 't', name: 'Task', kind: 'standard' },
    status: { id: 's', name: 'To Do', category: 'todo' },
    priority: { id: 'p', name: 'Medium', color: '#888888' },
    reporter: { id: 'u', display_name: 'Ann' },
    assignee: null,
    parent: null,
    labels: [],
    sprint,
    version,
    created_at: '2026-10-28T00:00:00Z',
    updated_at: '2026-10-28T00:00:00Z',
  };
}

const sprint = (id: string, name: string, state: string): Sprint => ({
  id,
  project_key: 'SCR',
  name,
  goal: null,
  state,
  start_at: null,
  end_at: null,
  completed_at: null,
  issue_count: 1,
});

const ACTIVE = sprint('sp-1', 'Sprint 1', 'active');
const NEXT = sprint('sp-2', 'Sprint 2', 'future');

function backlog(): Backlog {
  return {
    project_key: 'SCR',
    truncated: false,
    sprints: [
      {
        sprint: ACTIVE,
        issues: [issue('SCR-1', { id: ACTIVE.id, name: ACTIVE.name, state: 'active' }, 4)],
      },
      { sprint: NEXT, issues: [] },
    ],
    backlog: [issue('SCR-2')],
  };
}

const SESSION = {
  ...SIGNED_IN,
  user: { ...SIGNED_IN.user, email_verified: true },
  orgs: [{ slug: 'acme', name: 'Acme', role: 'member' }],
};
const PROJECT = {
  id: '33333333-3333-3333-3333-333333333333',
  key: 'SCR',
  name: 'Scrum',
  description: null,
  board_type: 'scrum',
  archived: false,
  my_role: 'member',
  permissions: ['sprint.manage', 'issue.edit', 'project.view'],
  created_at: '2026-10-27T00:00:00Z',
};

const BASE = {
  'GET /auth/session': () => json(SESSION),
  'GET /orgs/acme/projects/SCR': () => json(PROJECT),
};

describe('backlog page', () => {
  it('shows sprints and the backlog and moves an issue with If-Match', async () => {
    const calls = mockApi({
      ...BASE,
      'GET /orgs/acme/projects/SCR/backlog': () => json(backlog()),
      'POST /orgs/acme/issues/SCR-2/move': () => json(issue('SCR-2')),
    });
    renderApp('/o/acme/p/SCR/backlog');
    expect(await screen.findByRole('heading', { name: 'SCR backlog' })).toBeInTheDocument();
    const active = screen.getByRole('region', { name: 'Sprint 1' });
    expect(within(active).getByText('SCR-1')).toBeInTheDocument();
    expect(within(active).getByRole('button', { name: 'Complete sprint' })).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Move SCR-2 to'), 'Sprint 2');
    await waitFor(() => {
      expect(calls.some((c) => c.method === 'POST')).toBe(true);
    });
    const post = calls.find((c) => c.method === 'POST');
    expect(post?.headers.get('If-Match')).toBe('"v1"');
    expect(post?.body).toEqual({ sprint_id: NEXT.id });
  });

  it('completes the active sprint into the chosen future sprint', async () => {
    const calls = mockApi({
      ...BASE,
      'GET /orgs/acme/projects/SCR/backlog': () => json(backlog()),
      'POST /orgs/acme/sprints/sp-1/complete': () =>
        json({ sprint: { ...ACTIVE, state: 'closed' }, moved_issues: 1 }),
    });
    renderApp('/o/acme/p/SCR/backlog');
    await screen.findByRole('heading', { name: 'SCR backlog' });
    await userEvent.selectOptions(screen.getByLabelText(/Move open issues to/), 'Sprint 2');
    await userEvent.click(screen.getByRole('button', { name: 'Complete sprint' }));
    await waitFor(() => {
      expect(calls.some((c) => c.method === 'POST')).toBe(true);
    });
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ move_open_issues_to: NEXT.id });
  });

  it('shows the server error when a move is rejected', async () => {
    mockApi({
      ...BASE,
      'GET /orgs/acme/projects/SCR/backlog': () => json(backlog()),
      'POST /orgs/acme/issues/SCR-2/move': () => problem(409, 'sprint_closed'),
    });
    renderApp('/o/acme/p/SCR/backlog');
    await screen.findByRole('heading', { name: 'SCR backlog' });
    await userEvent.selectOptions(screen.getByLabelText('Move SCR-2 to'), 'Sprint 2');
    expect(await screen.findByText(/closed|error|went wrong|conflict/i)).toBeInTheDocument();
  });

  it('shows allowlisted copy when move is forbidden', async () => {
    mockApi({
      ...BASE,
      'GET /orgs/acme/projects/SCR/backlog': () => json(backlog()),
      'POST /orgs/acme/issues/SCR-2/move': () =>
        problem(403, 'forbidden', { detail: 'internal-only move denial' }),
    });
    renderApp('/o/acme/p/SCR/backlog');
    await screen.findByRole('heading', { name: 'SCR backlog' });
    await userEvent.selectOptions(screen.getByLabelText('Move SCR-2 to'), 'Sprint 2');
    const alert = await screen.findByRole('alert');
    expect(alert).not.toHaveTextContent('internal-only');
    expect(alert.textContent).toMatch(/permission/i);
  });

  it('offers no planning controls without sprint.manage', async () => {
    mockApi({
      ...BASE,
      'GET /orgs/acme/projects/SCR': () => json({ ...PROJECT, permissions: ['project.view'] }),
      'GET /orgs/acme/projects/SCR/backlog': () => json(backlog()),
    });
    renderApp('/o/acme/p/SCR/backlog');
    await screen.findByRole('heading', { name: 'SCR backlog' });
    expect(screen.queryByLabelText('Move SCR-2 to')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create sprint' })).not.toBeInTheDocument();
  });
});
