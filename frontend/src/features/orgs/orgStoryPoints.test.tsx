import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { json, mockApi, renderApp, SIGNED_IN } from '../../test/api';

const SESSION = {
  ...SIGNED_IN,
  user: { ...SIGNED_IN.user, email_verified: true },
  orgs: [{ slug: 'acme', name: 'Acme', role: 'owner' }],
};
const ORG_OWNER = {
  id: '22222222-2222-2222-2222-222222222222',
  slug: 'acme',
  name: 'Acme',
  role: 'owner',
  permissions: ['org.view', 'org.manage', 'org.members.manage', 'org.audit.view'],
  created_at: '2026-10-27T00:00:00Z',
};
const ORG_MEMBER = { ...ORG_OWNER, role: 'member', permissions: ['org.view'] };
const ORG_SETTINGS = {
  timezone: 'UTC',
  locale: 'en-US',
  story_points_enabled: true,
  story_points_max: 100,
  updated_at: '2026-10-27T00:00:00Z',
};
const SHELL = {
  'GET /orgs/acme/notifications/unread-count': () => json({ count: 0 }),
  'GET /orgs/acme/settings': () => json(ORG_SETTINGS),
};

describe('Org story points (General settings)', () => {
  it('shows loading state while settings load', async () => {
    mockApi({
      'GET /auth/session': () => json(SESSION),
      'GET /orgs/acme': () => json(ORG_OWNER),
      ...SHELL,
      'GET /orgs/acme/settings': () =>
        new Promise((resolve) => {
          window.setTimeout(() => {
            resolve(json(ORG_SETTINGS));
          }, 50);
        }),
    });
    renderApp('/o/acme/admin/general');
    await screen.findByRole('heading', { name: 'Story points' });
    expect(
      screen.getByRole('status', { name: /Loading story points settings/i }),
    ).toBeInTheDocument();
    expect(await screen.findByLabelText(/Allow story points/i)).toBeInTheDocument();
  });

  it('owner can disable story points without clearing maximum', async () => {
    const calls = mockApi({
      'GET /auth/session': () => json(SESSION),
      'GET /orgs/acme': () => json(ORG_OWNER),
      ...SHELL,
      'PATCH /orgs/acme/settings': () =>
        json({ ...ORG_SETTINGS, story_points_enabled: false }),
    });
    renderApp('/o/acme/admin/general');
    const user = userEvent.setup();
    const checkbox = await screen.findByLabelText(/Allow story points/i);
    expect(screen.getByLabelText('Maximum story points')).toHaveValue(100);
    await user.click(checkbox);
    expect(screen.getByLabelText('Maximum story points')).toHaveValue(100);
    await user.click(screen.getByRole('button', { name: 'Save story points settings' }));
    expect(await screen.findByText('Story points settings saved.')).toBeInTheDocument();
    const patch = calls.find((c) => c.method === 'PATCH' && c.path === '/orgs/acme/settings');
    expect(patch?.body).toEqual({ story_points_enabled: false });
  });

  it('owner can change maximum with partial PATCH', async () => {
    const calls = mockApi({
      'GET /auth/session': () => json(SESSION),
      'GET /orgs/acme': () => json(ORG_OWNER),
      ...SHELL,
      'PATCH /orgs/acme/settings': () => json({ ...ORG_SETTINGS, story_points_max: 21 }),
    });
    renderApp('/o/acme/admin/general');
    const user = userEvent.setup();
    const max = await screen.findByLabelText('Maximum story points');
    await user.clear(max);
    await user.type(max, '21');
    await user.click(screen.getByRole('button', { name: 'Save story points settings' }));
    expect(await screen.findByText('Story points settings saved.')).toBeInTheDocument();
    const patch = calls.find((c) => c.method === 'PATCH');
    expect(patch?.body).toEqual({ story_points_max: 21 });
  });

  it('member sees read-only values without save', async () => {
    mockApi({
      'GET /auth/session': () => json(SESSION),
      'GET /orgs/acme': () => json(ORG_MEMBER),
      ...SHELL,
    });
    renderApp('/o/acme/admin/general');
    expect(await screen.findByText('Enabled')).toBeInTheDocument();
    expect(screen.getByText('100')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save story points settings' })).toBeNull();
  });

  it('invalidates project settings queries after org settings save', async () => {
    let projectSettingsGets = 0;
    mockApi({
      'GET /auth/session': () => json(SESSION),
      'GET /orgs/acme': () => json(ORG_OWNER),
      ...SHELL,
      'GET /orgs/acme/projects/WEB/settings': () => {
        projectSettingsGets += 1;
        return json({
          organization: { story_points_enabled: true, story_points_max: 100 },
          overrides: { story_points_enabled: null, story_points_max: null },
          effective: { story_points_enabled: true, story_points_max: 100 },
          provenance: { story_points_enabled: 'organization', story_points_max: 'organization' },
          updated_at: null,
        });
      },
      'GET /orgs/acme/projects/WEB': () =>
        json({
          id: '33333333-3333-3333-3333-333333333333',
          key: 'WEB',
          name: 'Website',
          description: null,
          board_type: 'kanban',
          archived: false,
          my_role: 'admin',
          permissions: ['project.view', 'project.manage'],
          created_at: '2026-10-27T00:00:00Z',
        }),
      'PATCH /orgs/acme/settings': () => json({ ...ORG_SETTINGS, story_points_max: 21 }),
    });
    const { router } = renderApp('/o/acme/p/WEB?tab=estimates');
    await screen.findByText(/Effective for this project/i);
    expect(projectSettingsGets).toBe(1);
    await router.navigate('/o/acme/admin/general');
    await screen.findByRole('heading', { name: 'Story points' });
    const user = userEvent.setup();
    const max = await screen.findByLabelText('Maximum story points');
    await user.clear(max);
    await user.type(max, '21');
    await user.click(screen.getByRole('button', { name: 'Save story points settings' }));
    await screen.findByText('Story points settings saved.');
    await router.navigate('/o/acme/p/WEB?tab=estimates');
    await waitFor(() => {
      expect(projectSettingsGets).toBeGreaterThanOrEqual(2);
    });
  });
});
