import { screen, waitFor } from '@testing-library/react';
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
  permissions: ['org.audit.view', 'org.view', 'org.manage'],
  created_at: '2026-10-27T00:00:00Z',
};
const MEMBER_ROW = {
  user_id: '11111111-1111-1111-1111-111111111111',
  display_name: 'Alex Admin',
  email: 'alex@example.com',
  role: 'admin',
  can_create_projects: true,
  joined_at: '2026-10-01T00:00:00Z',
};
const SHELL = {
  'GET /orgs/acme/notifications/unread-count': () => json({ count: 0 }),
  'GET /orgs/acme/members': () => json({ items: [MEMBER_ROW] }),
  'GET /orgs/acme/projects': () => json({ items: [] }),
};
const EVENT = {
  id: 1,
  action: 'project.created',
  actor_user_id: MEMBER_ROW.user_id,
  outcome: 'success',
  target_type: 'project',
  target_id: 'p1',
  ip: null,
  user_agent: 'secret-agent',
  request_id: 'req-1',
  metadata: { project: 'WEB' },
  created_at: '2026-10-30T10:00:00Z',
};

function auditMocks(extra: Record<string, unknown> = {}) {
  return {
    'GET /auth/session': () => json(SESSION),
    'GET /orgs/acme': () => json(ORG),
    ...SHELL,
    ...extra,
  };
}

describe('audit log', () => {
  it('lists events on legacy and canonical routes with one page heading', async () => {
    mockApi({
      ...auditMocks(),
      'GET /orgs/acme/audit-events': () => json({ items: [EVENT], next_cursor: null }),
    });
    const legacy = renderApp('/o/acme/settings/audit');
    expect(
      await screen.findByRole('heading', { name: 'Audit Logs', level: 1 }),
    ).toBeInTheDocument();
    expect(await screen.findByRole('cell', { name: 'Alex Admin' })).toBeInTheDocument();
    expect(screen.queryByText('secret-agent')).toBeNull();
    legacy.unmount();

    mockApi({
      ...auditMocks(),
      'GET /orgs/acme/audit-events': () => json({ items: [EVENT], next_cursor: null }),
    });
    renderApp('/o/acme/admin/audit');
    expect(
      await screen.findByRole('heading', { name: 'Audit Logs', level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('shows No actor and Former member labels', async () => {
    mockApi({
      ...auditMocks(),
      'GET /orgs/acme/audit-events': () =>
        json({
          items: [
            { ...EVENT, id: 1, actor_user_id: null },
            {
              ...EVENT,
              id: 2,
              actor_user_id: '99999999-9999-9999-9999-999999999999',
            },
          ],
          next_cursor: null,
        }),
    });
    renderApp('/o/acme/admin/audit');
    expect(await screen.findByText('No actor')).toBeInTheDocument();
    expect(screen.getByText('Former member')).toBeInTheDocument();
    expect(screen.queryByRole('cell', { name: 'System' })).toBeNull();
  });

  it('sends action and actor filters without cursor on first fetch', async () => {
    const calls = mockApi({
      ...auditMocks(),
      'GET /orgs/acme/audit-events': () => json({ items: [EVENT], next_cursor: null }),
    });
    renderApp(`/o/acme/admin/audit?actor=${MEMBER_ROW.user_id}`);
    await screen.findByText('project.created');
    await waitFor(() => {
      const auditCalls = calls.filter((c) => c.path.includes('/audit-events'));
      expect(auditCalls.some((c) => c.search.includes(`actor=${MEMBER_ROW.user_id}`))).toBe(true);
    });
    const first = calls.find(
      (c) => c.path.includes('/audit-events') && c.search.includes(`actor=${MEMBER_ROW.user_id}`),
    );
    expect(first?.search.includes('cursor')).toBe(false);

    const user = userEvent.setup();
    const action = screen.getByLabelText('Action');
    await user.clear(action);
    await user.type(action, 'project.created');
    await user.tab();
    await waitFor(() => {
      expect(calls.some((c) => c.search.includes('action=project.created'))).toBe(true);
    });
    const withAction = calls.filter((c) => c.path.includes('/audit-events'));
    expect(withAction.at(-1)?.search.includes('cursor')).toBe(false);
  });

  it('omits invalid date params from the audit API request', async () => {
    const calls = mockApi({
      ...auditMocks(),
      'GET /orgs/acme/audit-events': () => json({ items: [], next_cursor: null }),
    });
    renderApp('/o/acme/admin/audit?from=not-a-date');
    await screen.findByText(/Invalid date; not applied/);
    await waitFor(() => {
      expect(calls.some((c) => c.path.includes('/audit-events'))).toBe(true);
    });
    const req = calls.find((c) => c.path.includes('/audit-events'));
    expect(req?.search.includes('from=')).toBe(false);
  });

  it('resets pagination when the filter changes after load more', async () => {
    const page2 = { ...EVENT, id: 2, action: 'org.updated' };
    const calls = mockApi({
      ...auditMocks(),
      'GET /orgs/acme/audit-events': (call) => {
        if (call.search.includes('cursor=c1')) {
          return json({ items: [page2], next_cursor: null });
        }
        if (call.search.includes('action=org.updated')) {
          return json({ items: [page2], next_cursor: null });
        }
        return json({ items: [EVENT], next_cursor: 'c1' });
      },
    });
    renderApp('/o/acme/admin/audit');
    await screen.findByText('project.created');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Load more' }));
    await screen.findByText('org.updated');
    expect(screen.getAllByText('org.updated')).toHaveLength(1);

    const action = screen.getByLabelText('Action');
    await user.clear(action);
    await user.type(action, 'org.updated');
    await user.tab();
    await waitFor(() => {
      const filtered = calls.filter(
        (c) => c.path.includes('/audit-events') && c.search.includes('action=org.updated'),
      );
      expect(filtered.length).toBeGreaterThan(0);
      expect(filtered.at(-1)?.search.includes('cursor')).toBe(false);
    });
    await waitFor(() => {
      expect(screen.getAllByText('org.updated')).toHaveLength(1);
    });
  });

  it('shows permission denied when the audit query returns forbidden', async () => {
    mockApi({
      ...auditMocks(),
      'GET /orgs/acme/audit-events': () =>
        problem(403, 'forbidden', { detail: 'must not appear in UI' }),
    });
    renderApp('/o/acme/settings/audit');
    expect(await screen.findByRole('region', { name: /don't have access/i })).toBeInTheDocument();
    expect(screen.queryByText('must not appear in UI')).not.toBeInTheDocument();
  });

  it('tells members without audit access that the log is restricted', async () => {
    const calls = mockApi({
      'GET /auth/session': () => json(SESSION),
      'GET /orgs/acme': () => json({ ...ORG, role: 'member', permissions: ['org.view'] }),
      ...SHELL,
    });
    renderApp('/o/acme/settings/audit');
    expect(await screen.findByRole('region', { name: /don't have access/i })).toHaveTextContent(
      /owners and admins/,
    );
    expect(calls.some((c) => c.path.includes('/audit-events'))).toBe(false);
    expect(calls.some((c) => c.path.includes('/members'))).toBe(false);
  });

  it('shows an active-filter chip, removes it, and expands row metadata', async () => {
    mockApi({
      ...auditMocks(),
      'GET /orgs/acme/audit-events': () => json({ items: [EVENT], next_cursor: null }),
    });
    renderApp('/o/acme/settings/audit?action=project.created');
    const chips = await screen.findByRole('list', { name: 'Active filters' });
    expect(chips).toHaveTextContent('Action: project.created');
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('button', { name: /Show details for project.created/ }),
    );
    expect(await screen.findByText(/"project": "WEB"/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remove Action filter' }));
    await waitFor(() => {
      expect(screen.queryByRole('list', { name: 'Active filters' })).toBeNull();
    });
  });
});
