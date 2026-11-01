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
  permissions: ['org.view', 'org.manage'],
  created_at: '2026-10-27T00:00:00Z',
};
const ORG_SETTINGS = {
  timezone: 'UTC',
  locale: 'en-US',
  story_points_enabled: true,
  story_points_max: 100,
  updated_at: '2026-10-27T00:00:00Z',
};
const PROJECT_MANAGE = {
  id: '33333333-3333-3333-3333-333333333333',
  key: 'WEB',
  name: 'Website',
  description: null,
  board_type: 'kanban',
  archived: false,
  my_role: 'admin',
  permissions: ['project.view', 'project.manage'],
  created_at: '2026-10-27T00:00:00Z',
};
const PROJECT_VIEW = {
  ...PROJECT_MANAGE,
  my_role: 'viewer',
  permissions: ['project.view'],
};
const SETTINGS_INHERIT = {
  organization: { story_points_enabled: true, story_points_max: 100 },
  overrides: { story_points_enabled: null, story_points_max: null },
  effective: { story_points_enabled: true, story_points_max: 100 },
  provenance: { story_points_enabled: 'organization', story_points_max: 'organization' },
  updated_at: null,
};

function shell(extra: Record<string, (call: unknown) => Response | Promise<Response>> = {}) {
  return {
    'GET /auth/session': () => json(SESSION),
    'GET /orgs/acme': () => json(ORG),
    'GET /orgs/acme/notifications/unread-count': () => json({ count: 0 }),
    'GET /orgs/acme/settings': () => json(ORG_SETTINGS),
    'GET /orgs/acme/projects/WEB': () => json(PROJECT_MANAGE),
    'GET /orgs/acme/projects/WEB/settings': () => json(SETTINGS_INHERIT),
    ...extra,
  };
}

describe('Project Estimates tab', () => {
  it('shows effective settings and inherit state', async () => {
    mockApi(shell());
    renderApp('/o/acme/p/WEB?tab=estimates');
    expect(await screen.findByText(/Effective for this project/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Effective for this project' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Enable story points' })).toHaveValue('inherit');
  });

  it('PATCHes only changed override field', async () => {
    const calls = mockApi({
      ...shell(),
      'PATCH /orgs/acme/projects/WEB/settings': () =>
        json({
          ...SETTINGS_INHERIT,
          overrides: { story_points_enabled: null, story_points_max: 8 },
          effective: { story_points_enabled: true, story_points_max: 8 },
          provenance: { story_points_enabled: 'organization', story_points_max: 'project' },
          updated_at: '2026-10-28T00:00:00Z',
        }),
    });
    renderApp('/o/acme/p/WEB?tab=estimates');
    const user = userEvent.setup();
    await screen.findByText(/Effective for this project/i);
    await user.selectOptions(screen.getByLabelText('Maximum story points'), 'custom');
    const maxInput = screen.getByRole('spinbutton');
    await user.clear(maxInput);
    await user.type(maxInput, '8');
    await user.click(screen.getByRole('button', { name: 'Save estimates settings' }));
    expect(await screen.findByText('Estimates settings saved.')).toBeInTheDocument();
    const patch = calls.find((c) => c.method === 'PATCH');
    expect(patch?.body).toEqual({ story_points_max_override: 8 });
  });

  it('reset sends both overrides as null', async () => {
    const calls = mockApi({
      ...shell({
        'GET /orgs/acme/projects/WEB/settings': () =>
          json({
            ...SETTINGS_INHERIT,
            overrides: { story_points_enabled: false, story_points_max: 8 },
            effective: { story_points_enabled: false, story_points_max: 8 },
            provenance: { story_points_enabled: 'project', story_points_max: 'project' },
          }),
      }),
      'PATCH /orgs/acme/projects/WEB/settings': () => json(SETTINGS_INHERIT),
    });
    renderApp('/o/acme/p/WEB?tab=estimates');
    const user = userEvent.setup();
    await screen.findByRole('button', { name: 'Reset to organization defaults' });
    await user.click(screen.getByRole('button', { name: 'Reset to organization defaults' }));
    await waitFor(() => {
      const patch = calls.find((c) => c.method === 'PATCH');
      expect(patch?.body).toEqual({
        story_points_enabled_override: null,
        story_points_max_override: null,
      });
    });
  });

  it('shows conflict panel from GET 409 without effective values', async () => {
    mockApi(
      shell({
        'GET /orgs/acme/projects/WEB/settings': () =>
          problem(409, 'project_settings_conflict', {
            detail:
              'Project overrides no longer match organization settings. Update or reset the conflicting override fields.',
            errors: [
              {
                field: 'story_points_max_override',
                message: 'conflicts with organization settings',
              },
            ],
          }),
      }),
    );
    renderApp('/o/acme/p/WEB?tab=estimates');
    expect(await screen.findByRole('alert')).toHaveTextContent(/conflict with organization/i);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Organization policy');
    expect(alert).toHaveTextContent(/maximum 100/);
    expect(screen.queryByText(/Effective for this project/i)).toBeNull();
  });

  it('clears conflicting max override from conflict panel', async () => {
    const calls = mockApi({
      ...shell({
        'GET /orgs/acme/projects/WEB/settings': () =>
          problem(409, 'project_settings_conflict', {
            errors: [{ field: 'story_points_max_override', message: 'conflicts' }],
          }),
      }),
      'PATCH /orgs/acme/projects/WEB/settings': () => json(SETTINGS_INHERIT),
    });
    renderApp('/o/acme/p/WEB?tab=estimates');
    const user = userEvent.setup();
    await screen.findByRole('button', { name: 'Clear maximum override' });
    await user.click(screen.getByRole('button', { name: 'Clear maximum override' }));
    await waitFor(() => {
      expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({
        story_points_max_override: null,
      });
    });
  });

  it('disables project enable override when organization disabled', async () => {
    mockApi({
      ...shell({
        'GET /orgs/acme/settings': () =>
          json({ ...ORG_SETTINGS, story_points_enabled: false }),
        'GET /orgs/acme/projects/WEB/settings': () =>
          json({
            organization: { story_points_enabled: false, story_points_max: 100 },
            overrides: { story_points_enabled: null, story_points_max: null },
            effective: { story_points_enabled: false, story_points_max: 100 },
            provenance: { story_points_enabled: 'organization', story_points_max: 'organization' },
            updated_at: null,
          }),
      }),
    });
    renderApp('/o/acme/p/WEB?tab=estimates');
    const enabled = await screen.findByLabelText('Enable story points');
    expect(enabled.querySelector('option[value="enabled"]')).toBeDisabled();
    expect(
      screen.getByText(/Story points are disabled for the organization/i),
    ).toBeInTheDocument();
  });

  it('viewer sees read-only configuration', async () => {
    mockApi({
      ...shell({
        'GET /orgs/acme/projects/WEB': () => json(PROJECT_VIEW),
        'GET /orgs/acme/projects/WEB/settings': () =>
          json({
            ...SETTINGS_INHERIT,
            overrides: { story_points_enabled: null, story_points_max: 8 },
            effective: { story_points_enabled: true, story_points_max: 8 },
            provenance: { story_points_enabled: 'organization', story_points_max: 'project' },
          }),
      }),
    });
    renderApp('/o/acme/p/WEB?tab=estimates');
    expect(await screen.findByText('Inherit organization')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save estimates settings' })).toBeNull();
  });

  it('archived project disables save and conflict recovery', async () => {
    mockApi({
      ...shell({
        'GET /orgs/acme/projects/WEB': () => json({ ...PROJECT_MANAGE, archived: true }),
        'GET /orgs/acme/projects/WEB/settings': () =>
          problem(409, 'project_settings_conflict', {
            errors: [{ field: 'story_points_max_override', message: 'conflicts' }],
          }),
      }),
    });
    renderApp('/o/acme/p/WEB?tab=estimates');
    await screen.findByRole('alert');
    expect(screen.queryByRole('button', { name: 'Clear maximum override' })).toBeNull();
    expect(screen.getByText(/archived and read-only/i)).toBeInTheDocument();
  });
});
