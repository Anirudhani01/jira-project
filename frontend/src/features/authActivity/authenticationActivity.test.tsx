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
const ACTIVITY_ITEM = {
  id: 42,
  user_id: MEMBER_ROW.user_id,
  member_display_name: 'Alex Admin',
  member_status: 'active' as const,
  event_type: 'auth.login.succeeded',
  outcome: 'success',
  reason: 'ok',
  metadata: { sessions_evicted: 2, rehashed: false },
  occurred_at: '2026-10-30T10:00:00Z',
};

function activityMocks(extra: Record<string, unknown> = {}) {
  return {
    'GET /auth/session': () => json(SESSION),
    'GET /orgs/acme': () => json(ORG),
    ...SHELL,
    ...extra,
  };
}

describe('authentication activity', () => {
  it('renders the admin security activity page with filters and activity table', async () => {
    mockApi({
      ...activityMocks(),
      'GET /orgs/acme/authentication-activity': () =>
        json({ items: [ACTIVITY_ITEM], next_cursor: null }),
    });
    renderApp('/o/acme/admin/security/activity');
    expect(
      await screen.findByRole('heading', { name: 'Authentication Activity', level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Filters' })).toBeInTheDocument();
    expect(await screen.findByRole('cell', { name: 'Alex Admin' })).toBeInTheDocument();
    expect(screen.getAllByText('Sign-in succeeded').length).toBeGreaterThan(0);
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toHaveTextContent(
      'Authentication Activity',
    );
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toHaveTextContent('Security');
  });

  it('denies members without audit permission and skips activity and member fetches', async () => {
    const calls = mockApi({
      'GET /auth/session': () => json(SESSION),
      'GET /orgs/acme': () => json({ ...ORG, role: 'member', permissions: ['org.view'] }),
      ...SHELL,
    });
    renderApp('/o/acme/admin/security/activity');
    expect(await screen.findByRole('region', { name: /don't have access/i })).toBeInTheDocument();
    expect(calls.some((c) => c.path.includes('/authentication-activity'))).toBe(false);
    expect(calls.some((c) => c.path.includes('/members'))).toBe(false);
  });

  it('syncs member and event type filters to the API without a cursor on first fetch', async () => {
    const calls = mockApi({
      ...activityMocks(),
      'GET /orgs/acme/authentication-activity': () =>
        json({ items: [ACTIVITY_ITEM], next_cursor: null }),
    });
    renderApp(
      `/o/acme/admin/security/activity?member=${MEMBER_ROW.user_id}&event_type=auth.login.succeeded`,
    );
    await screen.findByRole('cell', { name: 'Alex Admin' });
    await waitFor(() => {
      const hits = calls.filter((c) => c.path.includes('/authentication-activity'));
      expect(hits.length).toBeGreaterThan(0);
      const last = hits.at(-1);
      expect(last?.search.includes(`member=${MEMBER_ROW.user_id}`)).toBe(true);
      expect(last?.search.includes('event_type=auth.login.succeeded')).toBe(true);
      expect(last?.search.includes('cursor')).toBe(false);
    });
  });

  it('omits invalid URL filters from API requests', async () => {
    const calls = mockApi({
      ...activityMocks(),
      'GET /orgs/acme/authentication-activity': () => json({ items: [], next_cursor: null }),
    });
    renderApp('/o/acme/admin/security/activity?member=not-a-uuid&event_type=auth.signup.requested');
    expect(await screen.findByText(/Invalid member filter/)).toBeInTheDocument();
    expect(screen.getByText(/Unsupported event type/)).toBeInTheDocument();
    await waitFor(() => {
      expect(calls.some((c) => c.path.includes('/authentication-activity'))).toBe(true);
    });
    const req = calls.find((c) => c.path.includes('/authentication-activity'));
    expect(req?.search.includes('member=')).toBe(false);
    expect(req?.search.includes('event_type=')).toBe(false);
  });

  it('shows empty history and filtered-empty states', async () => {
    mockApi({
      ...activityMocks(),
      'GET /orgs/acme/authentication-activity': () => json({ items: [], next_cursor: null }),
    });
    renderApp('/o/acme/admin/security/activity');
    expect(
      await screen.findByText(/No authentication activity has been recorded/),
    ).toBeInTheDocument();

    mockApi({
      ...activityMocks(),
      'GET /orgs/acme/authentication-activity': () => json({ items: [], next_cursor: null }),
    });
    renderApp('/o/acme/admin/security/activity?event_type=auth.logout');
    expect(await screen.findByText(/No activity matches the selected filters/)).toBeInTheDocument();
  });

  it('supports cursor pagination and resets when filters change', async () => {
    const page2 = {
      ...ACTIVITY_ITEM,
      id: 43,
      event_type: 'auth.logout',
      reason: null,
      metadata: {},
    };
    const calls = mockApi({
      ...activityMocks(),
      'GET /orgs/acme/authentication-activity': (call) => {
        const params = new URLSearchParams(call.search.replace(/^\?/, ''));
        if (params.get('cursor') === 'c1') {
          return json({ items: [page2], next_cursor: null });
        }
        if (params.get('event_type') === 'auth.logout') {
          return json({ items: [page2], next_cursor: null });
        }
        return json({ items: [ACTIVITY_ITEM], next_cursor: 'c1' });
      },
    });
    renderApp('/o/acme/admin/security/activity');
    await screen.findByRole('cell', { name: 'Alex Admin' });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Load more' }));
    await waitFor(() => {
      expect(
        calls.filter((c) => c.path.includes('/authentication-activity')).length,
      ).toBeGreaterThan(1);
      expect(screen.getAllByText('Signed out').length).toBeGreaterThan(0);
    });

    await user.selectOptions(screen.getByLabelText('Event type'), 'auth.logout');
    await waitFor(() => {
      const filtered = calls.filter(
        (c) =>
          c.path.includes('/authentication-activity') &&
          c.search.includes('event_type=auth.logout'),
      );
      expect(filtered.at(-1)?.search.includes('cursor')).toBe(false);
    });
  });

  it('shows API errors with retry', async () => {
    mockApi({
      ...activityMocks(),
      'GET /orgs/acme/authentication-activity': () =>
        problem(500, 'server_error', { detail: 'database exploded' }),
    });
    renderApp('/o/acme/admin/security/activity');
    expect(await screen.findByRole('button', { name: /retry/i })).toBeInTheDocument();
    expect(screen.queryByText('database exploded')).not.toBeInTheDocument();
  });

  it('shows former members and hides sensitive fields from the UI', async () => {
    mockApi({
      ...activityMocks(),
      'GET /orgs/acme/authentication-activity': () =>
        json({
          items: [
            {
              ...ACTIVITY_ITEM,
              member_status: 'removed',
              member_display_name: 'Former Alex With A Very Long Display Name For Layout',
              metadata: { sessions_evicted: 1, rehashed: true },
            },
          ],
          next_cursor: null,
        }),
    });
    renderApp('/o/acme/admin/security/activity');
    expect(await screen.findByRole('cell', { name: /Former Alex/ })).toBeInTheDocument();
    expect(screen.getAllByText('Removed').length).toBeGreaterThan(0);
    const body = document.body.textContent || '';
    expect(body.includes('platform_event_id')).toBe(false);
    expect(body.includes('email_hmac')).toBe(false);
    expect(body.includes('203.0.113.1')).toBe(false);

    const user = userEvent.setup();
    const table = await screen.findByRole('table');
    const expand = await within(table).findByRole('button', {
      name: /Show metadata for Sign-in succeeded for Former Alex/i,
    });
    await user.click(expand);
    const panel = await screen.findByText(/"sessions_evicted": 1/);
    expect(panel).toBeInTheDocument();
    expect(screen.queryByText(/"ip"/)).toBeNull();
  });

  it('clears filters from the URL', async () => {
    mockApi({
      ...activityMocks(),
      'GET /orgs/acme/authentication-activity': () =>
        json({ items: [ACTIVITY_ITEM], next_cursor: null }),
    });
    renderApp('/o/acme/admin/security/activity?event_type=auth.login.succeeded');
    await screen.findByRole('list', { name: 'Active filters' });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => {
      expect(screen.queryByRole('list', { name: 'Active filters' })).toBeNull();
    });
  });

  it('uses a mobile-friendly activity list markup', async () => {
    mockApi({
      ...activityMocks(),
      'GET /orgs/acme/authentication-activity': () =>
        json({ items: [ACTIVITY_ITEM], next_cursor: null }),
    });
    renderApp('/o/acme/admin/security/activity');
    const mobileList = await screen.findByRole('list', { name: 'Authentication activity' });
    expect(within(mobileList).getByText('Sign-in succeeded')).toBeInTheDocument();
  });
});
