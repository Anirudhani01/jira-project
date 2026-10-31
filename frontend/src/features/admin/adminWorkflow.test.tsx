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
const WORKFLOW = {
  initial_status_id: S1,
  statuses: [{ id: S1, name: 'To Do', category: 'todo', position: 0 }],
  transitions: [],
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

describe('AdminWorkflowHubPage', () => {
  it('lists accessible projects with status, board type, and navigation links', async () => {
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
    expect(await screen.findByRole('heading', { name: 'Workflow' })).toBeInTheDocument();
    await waitFor(() => {
      expect(workflowCalls(calls)).toBe(1);
    });
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

  it('shows empty state when there are no accessible projects', async () => {
    mockApi({
      'GET /auth/session': () => json(SESSION),
      'GET /orgs/acme': () => json(ORG),
      'GET /orgs/acme/projects': projectsHandler([], []),
      ...SHELL,
    });
    renderApp('/o/acme/admin/workflow');
    expect(
      await screen.findByRole('heading', { name: 'No accessible projects' }),
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
