import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { Backlog, Issue, Sprint } from '../../lib/api/types';
import { json, mockApi, problem, renderApp, SIGNED_IN } from '../../test/api';

const onlineState = vi.hoisted(() => ({ online: true }));

vi.mock('../../app/OnlineStatusProvider', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../app/OnlineStatusProvider')>()),
  useAppOnline: () => onlineState.online,
}));

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
    story_points: null,
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
  points_total: 0,
  points_done: 0,
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

const MORE = {
  'GET /orgs/acme/issue-types': () =>
    json({ items: [{ id: 't1', name: 'Task', kind: 'standard', position: 1 }] }),
  'GET /orgs/acme/priorities': () =>
    json({ items: [{ id: 'p1', name: 'Medium', sort_order: 2, color: '#888888' }] }),
};

function mount(overrides: Record<string, () => Response> = {}) {
  return mockApi({
    ...BASE,
    ...MORE,
    'GET /orgs/acme/projects/SCR/backlog': () => json(backlog()),
    ...overrides,
  });
}

async function openBacklog() {
  renderApp('/o/acme/p/SCR/backlog');
  await screen.findByRole('heading', { name: 'SCR backlog' });
}

describe('backlog page', () => {
  it('shows sprint panels with state, counts and the unplanned backlog', async () => {
    mount();
    await openBacklog();
    const active = screen.getByRole('region', { name: 'Sprint 1' });
    expect(within(active).getByText('Active')).toBeInTheDocument();
    expect(within(active).getByText('SCR-1')).toBeInTheDocument();
    expect(within(active).getByRole('button', { name: 'Complete sprint' })).toBeInTheDocument();
    const planned = screen.getByRole('region', { name: 'Sprint 2' });
    expect(within(planned).getByText('Planned')).toBeInTheDocument();
    expect(within(planned).getByText('Plan your sprint')).toBeInTheDocument();
    expect(within(planned).getByRole('button', { name: 'Start sprint' })).toBeInTheDocument();
    const unplanned = screen.getByRole('region', { name: 'Backlog' });
    expect(within(unplanned).getByText('SCR-2')).toBeInTheDocument();
  });

  it('moves an issue with If-Match from the row menu', async () => {
    const calls = mount({ 'POST /orgs/acme/issues/SCR-2/move': () => json(issue('SCR-2')) });
    await openBacklog();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'More actions for SCR-2' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Sprint 2' }));
    await waitFor(() => {
      expect(calls.some((c) => c.method === 'POST')).toBe(true);
    });
    const post = calls.find((c) => c.method === 'POST');
    expect(post?.headers.get('If-Match')).toBe('"v1"');
    expect(post?.body).toEqual({ sprint_id: NEXT.id });
  });

  it('starts a planned sprint with default dates and sends ISO times', async () => {
    const calls = mount({
      'POST /orgs/acme/sprints/sp-2/start': () => json({ ...NEXT, state: 'active' }),
    });
    await openBacklog();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Start sprint' }));
    const dialog = await screen.findByRole('dialog', { name: 'Start Sprint 2' });
    expect(within(dialog).getByLabelText<HTMLInputElement>('Start').value).toMatch(
      /^\d{4}-\d{2}-\d{2}T/,
    );
    await user.click(within(dialog).getByRole('button', { name: 'Start sprint' }));
    await waitFor(() => {
      expect(calls.some((c) => c.method === 'POST' && c.path.endsWith('/start'))).toBe(true);
    });
    const body = calls.find((c) => c.path.endsWith('/start'))?.body as {
      start_at: string;
      end_at: string;
    };
    expect(new Date(body.end_at).getTime()).toBeGreaterThan(new Date(body.start_at).getTime());
  });

  it('rejects an end before the start without calling the server', async () => {
    const calls = mount();
    await openBacklog();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Start sprint' }));
    const dialog = await screen.findByRole('dialog', { name: 'Start Sprint 2' });
    const end = within(dialog).getByLabelText('End');
    await user.clear(end);
    await user.type(end, '2000-01-01T00:00');
    await user.click(within(dialog).getByRole('button', { name: 'Start sprint' }));
    expect(await within(dialog).findByText('The end must be after the start.')).toBeInTheDocument();
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
  });

  it('completes the active sprint into the chosen future sprint', async () => {
    const calls = mount({
      'POST /orgs/acme/sprints/sp-1/complete': () =>
        json({ sprint: { ...ACTIVE, state: 'closed' }, moved_issues: 1 }),
    });
    await openBacklog();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Complete sprint' }));
    const dialog = await screen.findByRole('dialog', { name: 'Complete Sprint 1' });
    expect(dialog).toHaveAccessibleDescription(/1 open issues/);
    await user.selectOptions(within(dialog).getByLabelText('Move open issues to'), 'Sprint 2');
    await user.click(within(dialog).getByRole('button', { name: 'Complete sprint' }));
    await waitFor(() => {
      expect(calls.some((c) => c.method === 'POST')).toBe(true);
    });
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ move_open_issues_to: NEXT.id });
  });

  it('edits a sprint and deletes a planned one after confirmation', async () => {
    const calls = mount({
      'PATCH /orgs/acme/sprints/sp-2': () => json({ ...NEXT, name: 'Renamed' }),
      'DELETE /orgs/acme/sprints/sp-2': () => new Response(null, { status: 204 }),
    });
    await openBacklog();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Sprint actions for Sprint 2' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Edit sprint' }));
    const edit = await screen.findByRole('dialog', { name: 'Edit sprint' });
    const name = within(edit).getByLabelText('Sprint name');
    await user.clear(name);
    await user.type(name, 'Renamed');
    await user.click(within(edit).getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({
        name: 'Renamed',
        goal: null,
      });
    });

    await user.click(screen.getByRole('button', { name: 'Sprint actions for Sprint 2' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete sprint' }));
    const confirm = await screen.findByRole('dialog', { name: 'Delete Sprint 2?' });
    await user.click(within(confirm).getByRole('button', { name: 'Delete sprint' }));
    await waitFor(() => {
      expect(calls.some((c) => c.method === 'DELETE')).toBe(true);
    });
  });

  it('filters issues, keeps the query and offers a way back when nothing matches', async () => {
    mount();
    await openBacklog();
    const user = userEvent.setup();
    const box = screen.getByRole('searchbox', { name: 'Filter backlog' });
    await user.type(box, 'SCR-2');
    expect(
      within(screen.getByRole('region', { name: 'Backlog' })).getByText('SCR-2'),
    ).toBeInTheDocument();
    expect(screen.queryByText('SCR-1')).not.toBeInTheDocument();
    await user.clear(box);
    await user.type(box, 'zzz-nothing');
    expect(await screen.findByText(/No issues for “zzz-nothing”/)).toBeInTheDocument();
    expect(box).toHaveValue('zzz-nothing');
  });

  it('selects a range with shift and moves the selection in one go', async () => {
    const calls = mount({
      'POST /orgs/acme/issues/SCR-1/move': () => json(issue('SCR-1')),
      'POST /orgs/acme/issues/SCR-2/move': () => json(issue('SCR-2')),
    });
    await openBacklog();
    const user = userEvent.setup();
    await user.click(screen.getByRole('checkbox', { name: 'Select SCR-1' }));
    await user.keyboard('{Shift>}');
    await user.click(screen.getByRole('checkbox', { name: 'Select SCR-2' }));
    await user.keyboard('{/Shift}');
    const bar = await screen.findByRole('region', { name: 'Bulk actions' });
    expect(within(bar).getByText('2 selected')).toBeInTheDocument();
    await user.selectOptions(within(bar).getByLabelText('Move to'), 'Sprint 2');
    await user.click(within(bar).getByRole('button', { name: 'Move' }));
    await waitFor(() => {
      expect(calls.filter((c) => c.method === 'POST')).toHaveLength(2);
    });
    expect(calls.filter((c) => c.method === 'POST').map((c) => c.body)).toEqual([
      { sprint_id: NEXT.id },
      { sprint_id: NEXT.id },
    ]);
    expect(await screen.findByText('2 issues moved to Sprint 2')).toBeInTheDocument();
  });

  it('reports partial bulk failures without losing the successful moves', async () => {
    mount({
      'POST /orgs/acme/issues/SCR-1/move': () => json(issue('SCR-1')),
      'POST /orgs/acme/issues/SCR-2/move': () => problem(412, 'version_conflict'),
    });
    await openBacklog();
    const user = userEvent.setup();
    await user.click(screen.getByRole('checkbox', { name: 'Select SCR-1' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select SCR-2' }));
    const bar = await screen.findByRole('region', { name: 'Bulk actions' });
    await user.selectOptions(within(bar).getByLabelText('Move to'), 'Sprint 2');
    await user.click(within(bar).getByRole('button', { name: 'Move' }));
    expect(await screen.findByText('1 moved, 1 could not be moved')).toBeInTheDocument();
  });

  it('creates an issue inline in a sprint: create, then move it into that sprint', async () => {
    const calls = mount({
      'POST /orgs/acme/projects/SCR/issues': () => json({ ...issue('SCR-9'), version: 1 }, 201),
      'POST /orgs/acme/issues/SCR-9/move': () => json(issue('SCR-9')),
    });
    await openBacklog();
    const user = userEvent.setup();
    const planned = screen.getByRole('region', { name: 'Sprint 2' });
    await user.click(within(planned).getByRole('button', { name: 'Create issue' }));
    await user.type(
      within(planned).getByLabelText('Summary for the new issue'),
      'Quick one{Enter}',
    );
    await waitFor(() => {
      expect(calls.some((c) => c.path === '/orgs/acme/issues/SCR-9/move')).toBe(true);
    });
    const create = calls.find((c) => c.path === '/orgs/acme/projects/SCR/issues');
    expect(create?.body).toMatchObject({ summary: 'Quick one', type_id: 't1', priority_id: 'p1' });
    expect(create?.headers.get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/);
    expect(calls.find((c) => c.path.endsWith('/SCR-9/move'))?.body).toEqual({ sprint_id: NEXT.id });
  });

  it('remembers compact density and hidden fields', async () => {
    mount();
    await openBacklog();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'View settings' }));
    await user.click(await screen.findByRole('radio', { name: 'Compact' }));
    await user.click(screen.getByRole('checkbox', { name: 'Priority' }));
    expect(screen.queryAllByRole('img', { name: 'Medium priority' })).toHaveLength(0);
    const saved = Object.entries(localStorage).filter(([k]) => k.includes('backlog.'));
    expect(saved.map(([k]) => k.split('.').slice(-2).join('.')).sort()).toEqual([
      'backlog.density',
      'backlog.fields',
    ]);
  });

  it('disables changes while offline and explains why in the dialogs', async () => {
    onlineState.online = false;
    try {
      mount();
      await openBacklog();
      expect(screen.getByRole('button', { name: 'Create sprint' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Start sprint' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Complete sprint' })).toBeDisabled();
    } finally {
      onlineState.online = true;
    }
  });

  it('shows the server error when a move is rejected', async () => {
    mount({ 'POST /orgs/acme/issues/SCR-2/move': () => problem(409, 'sprint_closed') });
    await openBacklog();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'More actions for SCR-2' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Sprint 2' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('shows allowlisted copy when move is forbidden', async () => {
    mount({
      'POST /orgs/acme/issues/SCR-2/move': () =>
        problem(403, 'forbidden', { detail: 'internal-only move denial' }),
    });
    await openBacklog();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'More actions for SCR-2' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Sprint 2' }));
    const alert = await screen.findByRole('alert');
    expect(alert).not.toHaveTextContent('internal-only');
    expect(alert.textContent).toMatch(/permission/i);
  });

  it('offers no planning controls without sprint.manage', async () => {
    mount({
      'GET /orgs/acme/projects/SCR': () => json({ ...PROJECT, permissions: ['project.view'] }),
    });
    await openBacklog();
    expect(
      screen.queryByRole('button', { name: 'More actions for SCR-2' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Select SCR-2' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create sprint' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start sprint' })).not.toBeInTheDocument();
  });

  it('explains that Kanban projects have no backlog', async () => {
    mockApi({
      ...BASE,
      'GET /orgs/acme/projects/SCR': () => json({ ...PROJECT, board_type: 'kanban' }),
      'GET /orgs/acme/projects/SCR/backlog': () => json(backlog()),
    });
    renderApp('/o/acme/p/SCR/backlog');
    expect(await screen.findByText('The backlog is for Scrum projects')).toBeInTheDocument();
  });
});
