import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { json, mockApi, problem, renderApp, SIGNED_IN } from '../../test/api';

const SESSION = {
  ...SIGNED_IN,
  user: { ...SIGNED_IN.user, email_verified: true },
  orgs: [{ slug: 'acme', name: 'Acme', role: 'member' }],
};
const ORG = {
  id: '22222222-2222-2222-2222-222222222222',
  slug: 'acme',
  name: 'Acme',
  role: 'member',
  permissions: ['org.view'],
  created_at: '2026-10-27T00:00:00Z',
};
const PROJECT = {
  id: '33333333-3333-3333-3333-333333333333',
  key: 'WEB',
  name: 'Website',
  description: null,
  board_type: 'kanban',
  archived: false,
  my_role: 'viewer',
  permissions: ['project.view'],
  created_at: '2026-10-27T00:00:00Z',
};
const S1 = '44444444-4444-4444-4444-444444444441';
const WORKFLOW = {
  initial_status_id: S1,
  statuses: [{ id: S1, name: 'To Do', category: 'todo', position: 0 }],
  transitions: [],
  columns: [{ name: 'To Do', position: 0, status_ids: [S1] }],
};

function deferredResponse() {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('org home project list', () => {
  it('lists visible projects and hides creation without the permission', async () => {
    mockApi({
      'GET /auth/session': () => json(SESSION),
      'GET /orgs/acme': () => json(ORG),
      'GET /orgs/acme/projects': () =>
        json({
          items: [
            {
              key: 'WEB',
              name: 'Website',
              board_type: 'kanban',
              archived: false,
              my_role: 'member',
            },
          ],
        }),
    });
    renderApp('/o/acme');
    expect(await screen.findByRole('link', { name: 'WEB — Website' })).toHaveAttribute(
      'href',
      '/o/acme/p/WEB/board',
    );
    expect(screen.queryByRole('link', { name: 'Create project' })).toBeNull();
  });

  it('offers creation with project.create', async () => {
    mockApi({
      'GET /auth/session': () => json(SESSION),
      'GET /orgs/acme': () => json({ ...ORG, permissions: ['org.view', 'project.create'] }),
      'GET /orgs/acme/projects': () => json({ items: [] }),
    });
    renderApp('/o/acme');
    expect(await screen.findByRole('link', { name: 'Create new project' })).toHaveAttribute(
      'href',
      '/o/acme/projects/new',
    );
  });
});

describe('CreateProjectPage', () => {
  it('shows loading before permission denial on the create step', async () => {
    const orgDeferred = deferredResponse();
    mockApi({
      'GET /auth/session': () => json(SESSION),
      'GET /orgs/acme': () => orgDeferred.promise,
    });
    renderApp('/o/acme/projects/new?board_type=kanban&step=create');
    expect(
      await screen.findByRole('status', { name: /Loading organization/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /don't have access/i })).not.toBeInTheDocument();
    orgDeferred.resolve(json(ORG));
    expect(await screen.findByRole('region', { name: /don't have access/i })).toBeInTheDocument();
  });

  it('denies the create step without project.create after org loads', async () => {
    mockApi({
      'GET /auth/session': () => json(SESSION),
      'GET /orgs/acme': () => json(ORG),
    });
    renderApp('/o/acme/projects/new?board_type=kanban&step=create');
    expect(await screen.findByRole('region', { name: /don't have access/i })).toHaveTextContent(
      /create projects/,
    );
    expect(screen.queryByLabelText('Name')).toBeNull();
  });

  it('shows template overview before the create form', async () => {
    mockApi({ 'GET /auth/session': () => json(SESSION) });
    renderApp('/o/acme/projects/new?board_type=kanban');
    expect(await screen.findByRole('heading', { name: 'Kanban template' })).toBeInTheDocument();
    expect(screen.getByText('Template overview')).toBeInTheDocument();
    expect(screen.getByText('Preview')).toBeInTheDocument();
    expect(screen.queryByLabelText('Name')).toBeNull();
    expect(screen.getByRole('link', { name: 'Use this template' })).toHaveAttribute(
      'href',
      '/o/acme/projects/new?board_type=kanban&step=create',
    );
  });

  it('creates a project with an uppercased key and opens it', async () => {
    const calls = mockApi({
      'GET /auth/session': () => json(SESSION),
      'GET /orgs/acme': () => json({ ...ORG, permissions: ['org.view', 'project.create'] }),
      'POST /orgs/acme/projects': () =>
        json(
          { key: 'WEB', name: 'Website', board_type: 'kanban', archived: false, my_role: 'admin' },
          201,
        ),
      'GET /orgs/acme/projects/WEB': () => json({ ...PROJECT, my_role: 'admin' }),
      'GET /orgs/acme/projects/WEB/workflow': () => json(WORKFLOW),
      'GET /orgs/acme/projects/WEB/members': () => json({ items: [] }),
    });
    const { router } = renderApp('/o/acme/projects/new?board_type=kanban&step=create');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Name'), 'Website');
    await user.type(screen.getByLabelText('Key'), 'web');
    await user.click(screen.getByRole('button', { name: 'Create project' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/o/acme/p/WEB/board');
    });
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      name: 'Website',
      key: 'WEB',
      board_type: 'kanban',
    });
  });

  it('shows a taken key on the field', async () => {
    mockApi({
      'GET /auth/session': () => json(SESSION),
      'GET /orgs/acme': () => json({ ...ORG, permissions: ['org.view', 'project.create'] }),
      'POST /orgs/acme/projects': () =>
        problem(409, 'project_key_taken', {
          errors: [{ field: 'body.key', message: 'is already used' }],
        }),
    });
    renderApp('/o/acme/projects/new?board_type=kanban&step=create');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Name'), 'Website');
    await user.type(screen.getByLabelText('Key'), 'WEB');
    await user.click(screen.getByRole('button', { name: 'Create project' }));
    expect(await screen.findByText('is already used')).toBeInTheDocument();
  });
});

describe('ProjectPage', () => {
  it('shows workflow and columns read-only for viewers', async () => {
    mockApi({
      'GET /auth/session': () => json(SESSION),
      'GET /orgs/acme/projects/WEB': () => json(PROJECT),
      'GET /orgs/acme/projects/WEB/workflow': () => json(WORKFLOW),
      'GET /orgs/acme/projects/WEB/members': () =>
        json({
          items: [{ user_id: 'u1', display_name: 'Ann', email: 'a@x.test', role: 'viewer' }],
        }),
    });
    renderApp('/o/acme/p/WEB');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'WEB — Website' }),
    ).toBeInTheDocument();
    expect(await screen.findByRole('table', { name: 'Board columns' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Column' })).toBeInTheDocument();
    expect(screen.getAllByText('To Do').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByRole('button', { name: 'Archive project' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Remove Ann/ })).toBeNull();
  });

  it('renders not-found for inaccessible projects', async () => {
    mockApi({
      'GET /auth/session': () => json(SESSION),
      'GET /orgs/acme/projects/SECRET': () => problem(404, 'not_found'),
      'GET /orgs/acme/projects/SECRET/workflow': () => problem(404, 'not_found'),
      'GET /orgs/acme/projects/SECRET/members': () => problem(404, 'not_found'),
    });
    renderApp('/o/acme/p/SECRET');
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });

  it('lets project managers archive', async () => {
    const calls = mockApi({
      'GET /auth/session': () => json(SESSION),
      'GET /orgs/acme/projects/WEB': () =>
        json({
          ...PROJECT,
          my_role: 'admin',
          permissions: ['project.manage', 'project.members.manage', 'project.view'],
        }),
      'GET /orgs/acme/projects/WEB/workflow': () => json(WORKFLOW),
      'GET /orgs/acme/projects/WEB/members': () => json({ items: [] }),
      'POST /orgs/acme/projects/WEB/archive': () => new Response(null, { status: 204 }),
    });
    renderApp('/o/acme/p/WEB');
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Archive project' }));
    await waitFor(() => {
      expect(calls.some((c) => c.path === '/orgs/acme/projects/WEB/archive')).toBe(true);
    });
    expect(calls.find((c) => c.path.endsWith('/archive'))?.headers.get('x-csrf-token')).toBe(
      'csrf-abc',
    );
  });
});
