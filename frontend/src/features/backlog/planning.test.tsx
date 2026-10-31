import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { Backlog, Epic, Issue, Sprint, Version } from '../../lib/api/types';
import { json, mockApi, problem, renderApp, SIGNED_IN } from '../../test/api';

import { filterByPlan, percent } from './backlogState';

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
  my_role: 'admin',
  permissions: [
    'sprint.manage',
    'version.manage',
    'issue.edit',
    'issue.assign',
    'issue.create',
    'issue.delete',
    'project.view',
  ],
  created_at: '2026-10-27T00:00:00Z',
};
const SPRINT: Sprint = {
  id: 'sp-1',
  project_key: 'SCR',
  name: 'Sprint 1',
  goal: null,
  state: 'active',
  start_at: null,
  end_at: null,
  completed_at: null,
  issue_count: 2,
  points_total: 0,
  points_done: 0,
};

function issue(key: string, extra: Partial<Issue> = {}): Issue {
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
    sprint: { id: SPRINT.id, name: SPRINT.name, state: 'active' },
    story_points: null,
    fix_version: null,
    version: 1,
    created_at: '2026-10-28T00:00:00Z',
    updated_at: '2026-10-28T00:00:00Z',
    ...extra,
  };
}

const EPIC: Epic = {
  id: 'epic-1',
  key: 'SCR-10',
  summary: 'Checkout',
  status: { id: 's', name: 'To Do', category: 'todo' },
  done: 1,
  total: 4,
};
const V1: Version = {
  id: 'v-1',
  project_key: 'SCR',
  name: '1.0',
  description: null,
  start_date: null,
  release_date: '2020-01-01',
  status: 'unreleased',
  released_at: null,
  position: 0,
  overdue: true,
  issue_count: 3,
  todo_count: 1,
  in_progress_count: 0,
  done_count: 2,
};
const V2: Version = {
  ...V1,
  id: 'v-2',
  name: '2.0',
  release_date: null,
  overdue: false,
  issue_count: 0,
  done_count: 0,
  todo_count: 0,
};

function backlog(): Backlog {
  return {
    project_key: 'SCR',
    truncated: false,
    sprints: [
      {
        sprint: SPRINT,
        issues: [
          issue('SCR-1', {
            parent: { id: EPIC.id, key: EPIC.key, summary: EPIC.summary },
            fix_version: { id: V1.id, name: V1.name, status: 'unreleased' },
          }),
          issue('SCR-2'),
        ],
      },
    ],
    backlog: [],
  };
}

function mount(overrides: Record<string, () => Response> = {}) {
  return mockApi({
    'GET /auth/session': () => json(SESSION),
    'GET /orgs/acme': () =>
      json({
        id: '1',
        slug: 'acme',
        name: 'Acme',
        role: 'member',
        permissions: ['org.view'],
        created_at: '2026-10-27T00:00:00Z',
      }),
    'GET /orgs/acme/projects/SCR': () => json(PROJECT),
    'GET /orgs/acme/projects/SCR/backlog': () => json(backlog()),
    'GET /orgs/acme/projects/SCR/epics': () => json({ items: [EPIC] }),
    'GET /orgs/acme/projects/SCR/versions': () => json({ items: [V1, V2] }),
    'GET /orgs/acme/projects/SCR/members': () => json({ items: [] }),
    'GET /orgs/acme/priorities': () =>
      json({ items: [{ id: 'p1', name: 'Medium', sort_order: 2, color: '#888888' }] }),
    'GET /orgs/acme/issue-types': () =>
      json({
        items: [
          { id: 't1', name: 'Task', kind: 'standard', position: 1 },
          { id: 'te', name: 'Epic', kind: 'epic', position: 0 },
        ],
      }),
    'GET /orgs/acme/projects/SCR/labels': () => json({ items: [] }),
    ...overrides,
  });
}

async function open(search = '') {
  renderApp(`/o/acme/p/SCR/backlog${search}`);
  await screen.findByRole('heading', { name: 'SCR backlog' });
}

describe('plan filters', () => {
  it('filters by epic key, version id and the "without" values', () => {
    const issues = backlog().sprints[0]?.issues ?? [];
    expect(filterByPlan(issues, { epic: 'SCR-10', version: '' }).map((i) => i.key)).toEqual([
      'SCR-1',
    ]);
    expect(filterByPlan(issues, { epic: 'none', version: '' }).map((i) => i.key)).toEqual([
      'SCR-2',
    ]);
    expect(filterByPlan(issues, { epic: '', version: 'v-1' }).map((i) => i.key)).toEqual(['SCR-1']);
    expect(filterByPlan(issues, { epic: '', version: 'none' }).map((i) => i.key)).toEqual([
      'SCR-2',
    ]);
    expect(filterByPlan(issues, { epic: '', version: '' })).toHaveLength(2);
    expect(percent(1, 4)).toBe(25);
    expect(percent(0, 0)).toBe(0);
  });
});

describe('epics panel', () => {
  it('opens with E, lists epics with progress and filters the backlog by the chosen epic', async () => {
    mount();
    await open();
    const user = userEvent.setup();
    expect(screen.queryByRole('complementary', { name: 'Epics panel' })).toBeNull();
    await user.keyboard('e');
    const panel = await screen.findByRole('complementary', { name: 'Epics panel' });
    expect(await within(panel).findByText('Checkout')).toBeInTheDocument();
    expect(within(panel).getByText('1/4 done')).toBeInTheDocument();
    expect(
      within(panel).getByRole('progressbar', { name: '1 of 4 issues done in Checkout' }),
    ).toHaveAttribute('aria-valuenow', '25');

    await user.click(within(panel).getByRole('button', { name: /Checkout/ }));
    expect(screen.getByText('SCR-1')).toBeInTheDocument();
    expect(screen.queryByText('SCR-2')).toBeNull();
    await user.click(within(panel).getByRole('button', { name: 'Issues without epic' }));
    expect(screen.getByText('SCR-2')).toBeInTheDocument();
    expect(screen.queryByText('SCR-1')).toBeNull();
    await user.click(within(panel).getByRole('button', { name: 'All issues' }));
    expect(screen.getByText('SCR-1')).toBeInTheDocument();
    await user.keyboard('e');
    expect(screen.queryByRole('complementary', { name: 'Epics panel' })).toBeNull();
  });

  it('ignores the E key while typing in the filter box', async () => {
    mount();
    await open();
    const user = userEvent.setup();
    await user.type(screen.getByRole('searchbox', { name: 'Filter backlog' }), 'e');
    expect(screen.queryByRole('complementary', { name: 'Epics panel' })).toBeNull();
  });

  it('creates an epic through the create dialog preset to the Epic type', async () => {
    mount();
    await open();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Epics' }));
    await user.click(await screen.findByRole('button', { name: 'Create epic' }));
    const dialog = await screen.findByRole('dialog', { name: 'Create issue' });
    expect(within(dialog).getByRole('combobox', { name: /^Type/ })).toHaveAccessibleName(/Epic/);
  });

  it('shows an empty state with the next step when there are no epics', async () => {
    mount({ 'GET /orgs/acme/projects/SCR/epics': () => json({ items: [] }) });
    await open();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Epics' }));
    expect(await screen.findByText('No epics yet')).toBeInTheDocument();
  });
});

describe('versions panel', () => {
  it('lists versions with status, overdue date and progress, and filters the backlog', async () => {
    mount();
    await open();
    const user = userEvent.setup();
    await user.keyboard('v');
    const panel = await screen.findByRole('complementary', { name: 'Versions panel' });
    expect(await within(panel).findByText('1.0')).toBeInTheDocument();
    expect(within(panel).getByText(/Overdue · /)).toBeInTheDocument();
    expect(within(panel).getByText('2/3 done')).toBeInTheDocument();
    await user.click(within(panel).getByRole('button', { name: /^1\.0/ }));
    expect(screen.getByText('SCR-1')).toBeInTheDocument();
    expect(screen.queryByText('SCR-2')).toBeNull();
    await user.click(within(panel).getByRole('button', { name: 'Issues without version' }));
    expect(screen.getByText('SCR-2')).toBeInTheDocument();
  });

  it('creates a version and shows a name conflict next to the field', async () => {
    const calls = mount({ 'POST /orgs/acme/projects/SCR/versions': () => json(V2, 201) });
    await open();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Versions' }));
    await user.click(await screen.findByRole('button', { name: 'Create version' }));
    const dialog = await screen.findByRole('dialog', { name: 'Create version' });
    await user.click(within(dialog).getByRole('button', { name: 'Create version' }));
    expect(await within(dialog).findByText('Enter a version name.')).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText('Name'), '3.0');
    await user.click(within(dialog).getByRole('button', { name: 'Create version' }));
    await waitFor(() => {
      expect(calls.some((c) => c.method === 'POST' && c.path.endsWith('/versions'))).toBe(true);
    });
    expect(
      calls.find((c) => c.path.endsWith('/versions') && c.method === 'POST')?.body,
    ).toMatchObject({
      name: '3.0',
    });
  });

  it('rejects a release date before the start date and shows the duplicate-name error', async () => {
    mount({
      'POST /orgs/acme/projects/SCR/versions': () => problem(409, 'version_name_taken'),
    });
    await open();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Versions' }));
    await user.click(await screen.findByRole('button', { name: 'Create version' }));
    const dialog = await screen.findByRole('dialog', { name: 'Create version' });
    await user.type(within(dialog).getByLabelText('Name'), '1.0');
    await user.type(within(dialog).getByLabelText('Start date (optional)'), '2026-12-01');
    await user.type(within(dialog).getByLabelText('Release date (optional)'), '2026-11-01');
    await user.click(within(dialog).getByRole('button', { name: 'Create version' }));
    expect(
      await within(dialog).findByText('The release date must not be before the start date.'),
    ).toBeInTheDocument();
    await user.clear(within(dialog).getByLabelText('Release date (optional)'));
    await user.click(within(dialog).getByRole('button', { name: 'Create version' }));
    expect(
      await within(dialog).findByText('A version with this name already exists.'),
    ).toBeInTheDocument();
  });

  it('releases a version, moving unresolved issues to another one', async () => {
    const calls = mount({
      'POST /orgs/acme/versions/v-1/release': () =>
        json({ version: { ...V1, status: 'released' }, moved_issues: 1 }),
    });
    await open();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Versions' }));
    await user.click(await screen.findByRole('button', { name: 'Version actions for 1.0' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Release' }));
    const dialog = await screen.findByRole('dialog', { name: 'Release 1.0' });
    expect(dialog).toHaveAccessibleDescription('2 of 3 issues are done.');
    await user.click(within(dialog).getByRole('radio', { name: 'Move them to another version' }));
    await user.selectOptions(within(dialog).getByLabelText('Move unresolved issues to'), '2.0');
    await user.click(within(dialog).getByRole('button', { name: 'Release version' }));
    await waitFor(() => {
      expect(calls.some((c) => c.path.endsWith('/release'))).toBe(true);
    });
    expect(calls.find((c) => c.path.endsWith('/release'))?.body).toMatchObject({
      unresolved: 'move',
      move_to: 'v-2',
    });
    expect(await screen.findByText('1.0 released')).toBeInTheDocument();
  });

  it('archives from the menu and deletes with a move target', async () => {
    const calls = mount({
      'POST /orgs/acme/versions/v-1/archive': () => json({ ...V1, status: 'archived' }),
      'DELETE /orgs/acme/versions/v-1': () => new Response(null, { status: 204 }),
    });
    await open();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Versions' }));
    await user.click(await screen.findByRole('button', { name: 'Version actions for 1.0' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Archive' }));
    await waitFor(() => {
      expect(calls.some((c) => c.path.endsWith('/archive'))).toBe(true);
    });
    await user.click(screen.getByRole('button', { name: 'Version actions for 1.0' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete version' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete 1.0?' });
    await user.click(within(dialog).getByRole('radio', { name: 'Move them to another version' }));
    await user.click(within(dialog).getByRole('button', { name: 'Delete version' }));
    await waitFor(() => {
      expect(calls.some((c) => c.method === 'DELETE')).toBe(true);
    });
    expect(calls.find((c) => c.method === 'DELETE')?.search).toBe('?move_to=v-2');
  });

  it('hides version management from people without version.manage', async () => {
    mount({
      'GET /orgs/acme/projects/SCR': () =>
        json({ ...PROJECT, permissions: ['sprint.manage', 'issue.edit', 'project.view'] }),
    });
    await open();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Versions' }));
    const panel = await screen.findByRole('complementary', { name: 'Versions panel' });
    await within(panel).findByText('1.0');
    expect(screen.queryByRole('button', { name: 'Create version' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Version actions for 1.0' })).toBeNull();
  });
});

describe('bulk actions', () => {
  const ok = (keys: string[]) =>
    json({
      results: keys.map((key) => ({ key, ok: true, code: null, message: null })),
      succeeded: keys.length,
      failed: 0,
    });

  it('sets a fix version for the selection in one request', async () => {
    const calls = mount({ 'POST /orgs/acme/issues/bulk': () => ok(['SCR-1', 'SCR-2']) });
    await open();
    const user = userEvent.setup();
    await user.click(screen.getByRole('checkbox', { name: 'Select SCR-1' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select SCR-2' }));
    const bar = await screen.findByRole('region', { name: 'Bulk actions' });
    await user.selectOptions(within(bar).getByLabelText('Action'), 'Set fix version');
    await user.selectOptions(within(bar).getByLabelText('Value'), '2.0');
    await user.click(within(bar).getByRole('button', { name: 'Apply' }));
    await waitFor(() => {
      expect(calls.some((c) => c.path.endsWith('/issues/bulk'))).toBe(true);
    });
    expect(calls.find((c) => c.path.endsWith('/issues/bulk'))?.body).toEqual({
      keys: ['SCR-1', 'SCR-2'],
      action: 'set_fix_version',
      fix_version_id: 'v-2',
    });
  });

  it('can clear the epic and asks for confirmation before deleting', async () => {
    const calls = mount({ 'POST /orgs/acme/issues/bulk': () => ok(['SCR-1']) });
    await open();
    const user = userEvent.setup();
    await user.click(screen.getByRole('checkbox', { name: 'Select SCR-1' }));
    const bar = await screen.findByRole('region', { name: 'Bulk actions' });
    await user.selectOptions(within(bar).getByLabelText('Action'), 'Set epic');
    await user.selectOptions(within(bar).getByLabelText('Value'), 'No epic');
    await user.click(within(bar).getByRole('button', { name: 'Apply' }));
    await waitFor(() => {
      expect(calls.some((c) => c.path.endsWith('/issues/bulk'))).toBe(true);
    });
    expect(calls.find((c) => c.path.endsWith('/issues/bulk'))?.body).toEqual({
      keys: ['SCR-1'],
      action: 'set_parent',
      parent_id: null,
    });

    await user.click(screen.getByRole('checkbox', { name: 'Select SCR-1' }));
    const bar2 = await screen.findByRole('region', { name: 'Bulk actions' });
    await user.selectOptions(within(bar2).getByLabelText('Action'), 'Delete');
    await user.click(within(bar2).getByRole('button', { name: 'Delete…' }));
    const confirm = await screen.findByRole('dialog', { name: 'Delete 1 issue?' });
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1);
    await user.click(within(confirm).getByRole('button', { name: 'Delete' }));
    await waitFor(() => {
      expect(calls.filter((c) => c.method === 'POST')).toHaveLength(2);
    });
    expect(calls.filter((c) => c.method === 'POST')[1]?.body).toEqual({
      keys: ['SCR-1'],
      action: 'delete',
    });
  });

  it('only offers the actions the person may use', async () => {
    mount({
      'GET /orgs/acme/projects/SCR': () =>
        json({ ...PROJECT, permissions: ['sprint.manage', 'project.view'] }),
    });
    await open();
    const user = userEvent.setup();
    await user.click(screen.getByRole('checkbox', { name: 'Select SCR-1' }));
    const bar = await screen.findByRole('region', { name: 'Bulk actions' });
    const options = within(within(bar).getByLabelText('Action')).getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(['Move to sprint']);
  });
});
