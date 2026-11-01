import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { json, mockApi, problem, renderApp, SIGNED_IN } from '../../test/api';

const SESSION = {
  ...SIGNED_IN,
  user: { ...SIGNED_IN.user, email_verified: true },
  orgs: [{ slug: 'acme', name: 'Acme', role: 'owner' }],
};
const ORG = {
  id: '22222222-2222-2222-2222-222222222222',
  slug: 'acme',
  name: 'Acme',
  role: 'owner',
  permissions: ['org.view', 'org.manage'],
  created_at: '2026-10-27T00:00:00Z',
};
const ORG_MEMBER = {
  ...ORG,
  role: 'member',
  permissions: ['org.view'],
};
const SHELL = {
  'GET /orgs/acme/notifications/unread-count': () => json({ count: 0 }),
};
const ACTIVE = [
  { key: 'WEB', name: 'Website', board_type: 'kanban', archived: false, my_role: 'admin' },
];
const ARCHIVED = [
  { key: 'OLD', name: 'Legacy', board_type: 'scrum', archived: true, my_role: 'admin' },
];
const S1 = '44444444-4444-4444-4444-444444444441';
const S2 = '44444444-4444-4444-4444-444444444442';
const UNKNOWN_FROM = '99999999-9999-9999-9999-999999999999';
const UNKNOWN_TO = '88888888-8888-8888-8888-888888888888';
const WORKFLOW = {
  name: 'Default workflow',
  initial_status_id: S1,
  statuses: [
    { id: S1, name: 'To Do', category: 'todo', position: 0 },
    { id: S2, name: 'Done', category: 'done', position: 1 },
  ],
  transitions: [
    {
      id: '66666666-6666-6666-6666-666666666661',
      name: 'Move to Done',
      from_status_id: null,
      to_status_id: S2,
    },
    {
      id: '66666666-6666-6666-6666-666666666662',
      name: 'Broken edge',
      from_status_id: UNKNOWN_FROM,
      to_status_id: UNKNOWN_TO,
    },
  ],
  columns: [{ name: 'To Do', position: 0, status_ids: [S1] }],
};

function projectsHandler(active = ACTIVE, archived = ARCHIVED) {
  return (call: { search: string }) => {
    if (call.search.includes('archived=true')) return json({ items: archived });
    return json({ items: active });
  };
}

function workflowCalls(calls: { path: string; method: string }[]) {
  return calls.filter((c) => c.method === 'GET' && c.path.endsWith('/workflow')).length;
}

/** Active project list (`GET /orgs/{org}/projects` without `archived=true`). */
function activeProjectListCalls(calls: { path: string; method: string; search: string }[]) {
  return calls.filter(
    (c) =>
      c.method === 'GET' && c.path === '/orgs/acme/projects' && !c.search.includes('archived=true'),
  ).length;
}

/** Hub-only archived list (AuthorizedAdminWorkflowHub second query). */
function hubArchivedProjectListCalls(calls: { path: string; method: string; search: string }[]) {
  return calls.filter(
    (c) =>
      c.method === 'GET' && c.path === '/orgs/acme/projects' && c.search.includes('archived=true'),
  ).length;
}

const HUB_DESCRIPTION_SNIPPET = 'individual GET requests';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AdminWorkflowHubPage', () => {
  it('lists organization projects with status, board type, and navigation links', async () => {
    mockApi({
      'GET /auth/session': () => json(SESSION),
      'GET /orgs/acme': () => json(ORG),
      'GET /orgs/acme/projects': projectsHandler(),
      ...SHELL,
    });
    renderApp('/o/acme/admin/workflow');
    expect(await screen.findByRole('heading', { name: 'Workflows' })).toBeInTheDocument();
    expect(await screen.findByText('Website')).toBeInTheDocument();
    expect(screen.getByText('Legacy')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Archived')).toBeInTheDocument();
    expect(screen.getByText('Scrum')).toBeInTheDocument();
    const boardLinks = screen.getAllByRole('link', { name: 'Board' });
    expect(boardLinks.some((l) => l.getAttribute('href') === '/o/acme/p/WEB/board')).toBe(true);
    const settingsLinks = screen.getAllByRole('link', { name: 'Project settings' });
    expect(settingsLinks.some((l) => l.getAttribute('href') === '/o/acme/p/WEB')).toBe(true);
  });

  it('does not fetch workflow until a project row is expanded', async () => {
    const calls = mockApi({
      'GET /auth/session': () => json(SESSION),
      'GET /orgs/acme': () => json(ORG),
      'GET /orgs/acme/projects': projectsHandler(),
      'GET /orgs/acme/projects/WEB/workflow': () => json(WORKFLOW),
      ...SHELL,
    });
    renderApp('/o/acme/admin/workflow');
    await screen.findByText('Website');
    expect(workflowCalls(calls)).toBe(0);
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('button', { name: /Expand workflow details for WEB/i }),
    );
    expect(await screen.findByRole('heading', { name: 'Default workflow' })).toBeInTheDocument();
    await waitFor(() => {
      expect(workflowCalls(calls)).toBe(1);
    });
  });

  it('shows workflow name, ordered statuses, initial badge, transitions, and project context', async () => {
    mockApi({
      'GET /auth/session': () => json(SESSION),
      'GET /orgs/acme': () => json(ORG),
      'GET /orgs/acme/projects': projectsHandler(),
      'GET /orgs/acme/projects/WEB/workflow': () => json(WORKFLOW),
      ...SHELL,
    });
    renderApp('/o/acme/admin/workflow');
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('button', { name: /Expand workflow details for WEB/i }),
    );
    expect(await screen.findByText('Read-only')).toBeInTheDocument();
    const panel = document.getElementById('admin-workflow-panel-WEB');
    if (!panel) throw new Error('Expected WEB workflow panel');
    expect(
      within(panel).getByText((_, element) => {
        const text = element?.textContent;
        if (!text) return false;
        return text.startsWith('Project') && text.includes('WEB') && text.includes('Website');
      }),
    ).toBeInTheDocument();
    const statusTable = await screen.findByRole('table', { name: 'Workflow statuses' });
    const statusRows = within(statusTable).getAllByRole('row');
    expect(statusRows[1]).toHaveTextContent('0');
    expect(statusRows[1]).toHaveTextContent('To Do');
    expect(statusRows[1]).toHaveTextContent('Initial');
    expect(statusRows[2]).toHaveTextContent('1');
    expect(statusRows[2]).toHaveTextContent('Done');
    const transitionTable = screen.getByRole('table', { name: 'Workflow transitions' });
    expect(within(transitionTable).getByText('Any status')).toBeInTheDocument();
    expect(within(transitionTable).getByText('Move to Done')).toBeInTheDocument();
    expect(
      within(transitionTable).getByText(`Unknown (${UNKNOWN_FROM.slice(0, 8)}…)`),
    ).toBeInTheDocument();
    expect(
      within(transitionTable).getByText(`Unknown (${UNKNOWN_TO.slice(0, 8)}…)`),
    ).toBeInTheDocument();
  });

  it('reuses cached workflow data when re-expanding without extra requests', async () => {
    const calls = mockApi({
      'GET /auth/session': () => json(SESSION),
      'GET /orgs/acme': () => json(ORG),
      'GET /orgs/acme/projects': projectsHandler(),
      'GET /orgs/acme/projects/WEB/workflow': () => json(WORKFLOW),
      ...SHELL,
    });
    renderApp('/o/acme/admin/workflow');
    const user = userEvent.setup();
    const expand = async () => {
      await user.click(screen.getByRole('button', { name: /Expand workflow details for WEB/i }));
    };
    const collapse = async () => {
      await user.click(screen.getByRole('button', { name: /Collapse workflow details for WEB/i }));
    };
    await screen.findByText('Website');
    await expand();
    await screen.findByRole('table', { name: 'Board columns' });
    await waitFor(() => {
      expect(workflowCalls(calls)).toBe(1);
    });
    await collapse();
    await expand();
    await screen.findByRole('table', { name: 'Board columns' });
    expect(workflowCalls(calls)).toBe(1);
  });

  it('retries workflow load independently when expansion fails', async () => {
    let fail = true;
    mockApi({
      'GET /auth/session': () => json(SESSION),
      'GET /orgs/acme': () => json(ORG),
      'GET /orgs/acme/projects': projectsHandler(),
      'GET /orgs/acme/projects/WEB/workflow': () => {
        if (fail) return problem(500, 'internal_error');
        return json(WORKFLOW);
      },
      ...SHELL,
    });
    renderApp('/o/acme/admin/workflow');
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('button', { name: /Expand workflow details for WEB/i }),
    );
    const panel = document.getElementById('admin-workflow-panel-WEB');
    if (!panel) throw new Error('Expected WEB workflow panel');
    expect(await within(panel).findByRole('button', { name: 'Retry' })).toBeInTheDocument();
    fail = false;
    await user.click(within(panel).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('table', { name: 'Board columns' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Workflows' })).toBeInTheDocument();
  });

  it('shows empty state when there are no organization projects', async () => {
    mockApi({
      'GET /auth/session': () => json(SESSION),
      'GET /orgs/acme': () => json(ORG),
      'GET /orgs/acme/projects': projectsHandler([], []),
      ...SHELL,
    });
    renderApp('/o/acme/admin/workflow');
    expect(
      await screen.findByRole('heading', { name: 'No organization projects' }),
    ).toBeInTheDocument();
  });

  it('keeps the hub usable when workflow is inaccessible for a listed project', async () => {
    mockApi({
      'GET /auth/session': () => json(SESSION),
      'GET /orgs/acme': () => json(ORG),
      'GET /orgs/acme/projects': projectsHandler(
        [{ key: 'BAD', name: 'Broken', board_type: 'kanban', archived: false, my_role: 'member' }],
        [],
      ),
      'GET /orgs/acme/projects/BAD/workflow': () => problem(404, 'not_found'),
      ...SHELL,
    });
    renderApp('/o/acme/admin/workflow');
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('button', { name: /Expand workflow details for BAD/i }),
    );
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Workflows' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Archive project' })).toBeNull();
  });

  it('does not expose workflow editing controls', async () => {
    mockApi({
      'GET /auth/session': () => json(SESSION),
      'GET /orgs/acme': () => json(ORG),
      'GET /orgs/acme/projects': projectsHandler(),
      'GET /orgs/acme/projects/WEB/workflow': () => json(WORKFLOW),
      ...SHELL,
    });
    renderApp('/o/acme/admin/workflow');
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('button', { name: /Expand workflow details for WEB/i }),
    );
    await screen.findByRole('table', { name: 'Board columns' });
    expect(screen.queryByRole('button', { name: /save/i })).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});

describe('Admin workflow navigation and access', () => {
  it('hides Workflows nav for members without org.manage', async () => {
    mockApi({
      'GET /auth/session': () => json(SESSION),
      'GET /orgs/acme': () => json(ORG_MEMBER),
      ...SHELL,
    });
    renderApp('/o/acme/admin/general');
    const adminNav = await screen.findByRole('navigation', { name: 'Administration' });
    expect(adminNav).not.toHaveTextContent('Workflows');
    expect(screen.queryByRole('link', { name: 'Boards' })).toBeNull();
  });

  it('shows Workflows nav for org managers', async () => {
    mockApi({
      'GET /auth/session': () => json(SESSION),
      'GET /orgs/acme': () => json(ORG),
      ...SHELL,
    });
    renderApp('/o/acme/admin/general');
    const adminNav = await screen.findByRole('navigation', { name: 'Administration' });
    expect(adminNav).toHaveTextContent('Workflows');
  });

  it('denies direct hub access for members without hub-owned project or workflow fetches', async () => {
    const calls = mockApi({
      'GET /auth/session': () => json(SESSION),
      'GET /orgs/acme': () => json(ORG_MEMBER),
      ...SHELL,
    });
    renderApp('/o/acme/admin/workflow');
    expect(await screen.findByRole('region', { name: /don't have access/i })).toBeInTheDocument();
    expect(hubArchivedProjectListCalls(calls)).toBe(0);
    expect(workflowCalls(calls)).toBe(0);
    expect(screen.queryByText(HUB_DESCRIPTION_SNIPPET)).not.toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'Loading projects' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Expand workflow details/i }),
    ).not.toBeInTheDocument();
  });
});

/**
 * Active `GET /orgs/{org}/projects` on Administration routes comes from the global shell
 * (ProjectSwitcher, GlobalSearchBar, CommandPalette), not GlobalSidebar (hidden in admin).
 * AuthorizedAdminWorkflowHub adds a second list fetch with `archived=true` when mounted.
 */
describe('Admin Workflow Hub permission isolation', () => {
  it('member on admin general triggers shell active project list only (baseline)', async () => {
    const calls = mockApi({
      'GET /auth/session': () => json(SESSION),
      'GET /orgs/acme': () => json(ORG_MEMBER),
      ...SHELL,
    });
    renderApp('/o/acme/admin/general');
    await screen.findByRole('navigation', { name: 'Administration' });
    await waitFor(() => {
      expect(activeProjectListCalls(calls)).toBe(1);
    });
    expect(hubArchivedProjectListCalls(calls)).toBe(0);
    expect(workflowCalls(calls)).toBe(0);
  });

  it('member on admin workflow matches baseline: no hub archived list, no workflow, hub unmounted', async () => {
    const calls = mockApi({
      'GET /auth/session': () => json(SESSION),
      'GET /orgs/acme': () => json(ORG_MEMBER),
      ...SHELL,
    });
    renderApp('/o/acme/admin/workflow');
    expect(await screen.findByRole('region', { name: /don't have access/i })).toBeInTheDocument();
    await waitFor(() => {
      expect(activeProjectListCalls(calls)).toBe(1);
    });
    expect(hubArchivedProjectListCalls(calls)).toBe(0);
    expect(workflowCalls(calls)).toBe(0);
    expect(screen.queryByText(HUB_DESCRIPTION_SNIPPET)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Expand workflow details/i }),
    ).not.toBeInTheDocument();
  });

  it('mounts AuthorizedAdminWorkflowHub for org managers (archived list + hub UI)', async () => {
    mockApi({
      'GET /auth/session': () => json(SESSION),
      'GET /orgs/acme': () => json(ORG),
      'GET /orgs/acme/projects': projectsHandler(),
      ...SHELL,
    });
    renderApp('/o/acme/admin/workflow');
    expect(await screen.findByRole('heading', { name: 'Workflows', level: 1 })).toBeInTheDocument();
    expect(await screen.findByText(/cloned from the default workflow/i)).toBeInTheDocument();
    expect(
      await screen.findByRole('button', { name: /Expand workflow details for WEB/i }),
    ).toBeInTheDocument();
  });

  it('owner hub issues active and archived project list requests when mounted', async () => {
    const calls = mockApi({
      'GET /auth/session': () => json(SESSION),
      'GET /orgs/acme': () => json(ORG),
      'GET /orgs/acme/projects': projectsHandler(),
      ...SHELL,
    });
    renderApp('/o/acme/admin/workflow');
    await screen.findByText('Website');
    await waitFor(() => {
      expect(activeProjectListCalls(calls)).toBeGreaterThanOrEqual(1);
      expect(hubArchivedProjectListCalls(calls)).toBe(1);
    });
  });
});
