import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { json, mockApi, problem, renderApp, SIGNED_IN } from '../../test/api';

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
const ORG_ADMIN = { ...ORG_OWNER, role: 'admin' };
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

function settingsHandlers(
  extra: Record<string, (call: unknown) => Response | Promise<Response>> = {},
) {
  return {
    'GET /auth/session': () => json(SESSION),
    'GET /orgs/acme': () => json(ORG_OWNER),
    ...SHELL,
    ...extra,
  };
}

describe('Org regional preferences (General settings)', () => {
  it('shows loading state while settings load', async () => {
    mockApi({
      'GET /auth/session': () => json(SESSION),
      'GET /orgs/acme': () => json(ORG_OWNER),
      'GET /orgs/acme/notifications/unread-count': () => json({ count: 0 }),
      'GET /orgs/acme/settings': () =>
        new Promise((resolve) => {
          window.setTimeout(() => {
            resolve(json(ORG_SETTINGS));
          }, 50);
        }),
    });
    renderApp('/o/acme/admin/general');
    await screen.findByRole('heading', { name: 'Regional preferences' });
    expect(
      screen.getByRole('status', { name: /Loading regional preferences/i }),
    ).toBeInTheDocument();
    expect(await screen.findByLabelText('Timezone')).toBeInTheDocument();
  });

  it('owner can edit and save regional preferences', async () => {
    const calls = mockApi({
      ...settingsHandlers(),
      'PATCH /orgs/acme/settings': () =>
        json({ ...ORG_SETTINGS, timezone: 'Europe/London', locale: 'en-GB' }),
    });
    renderApp('/o/acme/admin/general');
    const user = userEvent.setup();
    await screen.findByLabelText('Timezone');
    await user.selectOptions(screen.getByLabelText('Timezone'), 'Europe/London');
    await user.selectOptions(screen.getByLabelText('Locale'), 'en-GB');
    await user.click(screen.getByRole('button', { name: 'Save preferences' }));
    expect(await screen.findByText('Regional preferences saved.')).toBeInTheDocument();
    const patch = calls.find((c) => c.method === 'PATCH' && c.path === '/orgs/acme/settings');
    expect(patch?.body).toEqual({ timezone: 'Europe/London', locale: 'en-GB' });
  });

  it('admin can save regional preferences', async () => {
    mockApi({
      'GET /auth/session': () => json(SESSION),
      'GET /orgs/acme': () => json(ORG_ADMIN),
      ...SHELL,
      'PATCH /orgs/acme/settings': () => json({ ...ORG_SETTINGS, timezone: 'America/New_York' }),
    });
    renderApp('/o/acme/admin/general');
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByLabelText('Timezone'), 'America/New_York');
    await user.click(screen.getByRole('button', { name: 'Save preferences' }));
    expect(await screen.findByText('Regional preferences saved.')).toBeInTheDocument();
  });

  it('member sees read-only timezone and locale without save', async () => {
    mockApi({
      'GET /auth/session': () => json(SESSION),
      'GET /orgs/acme': () => json(ORG_MEMBER),
      ...SHELL,
    });
    renderApp('/o/acme/admin/general');
    expect(await screen.findByText('UTC')).toBeInTheDocument();
    expect(screen.getByText('en-US')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save preferences' })).toBeNull();
    expect(screen.queryByLabelText('Timezone')).toBeNull();
    expect(
      screen.getByText(/Only organization owners and admins can change regional/),
    ).toBeInTheDocument();
  });

  it('does not PATCH when nothing changed', async () => {
    const calls = mockApi(settingsHandlers());
    renderApp('/o/acme/admin/general');
    await screen.findByLabelText('Timezone');
    const save = screen.getByRole('button', { name: 'Save preferences' });
    expect(save).toBeDisabled();
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(0);
  });

  it('maps server validation errors onto fields', async () => {
    mockApi({
      ...settingsHandlers(),
      'PATCH /orgs/acme/settings': () =>
        problem(422, 'validation_error', {
          errors: [{ field: 'body.timezone', message: 'Unknown timezone.' }],
        }),
    });
    renderApp('/o/acme/admin/general');
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByLabelText('Timezone'), 'Europe/London');
    await user.click(screen.getByRole('button', { name: 'Save preferences' }));
    expect(await screen.findByText('Unknown timezone.')).toBeInTheDocument();
    expect(screen.getByLabelText('Timezone')).toHaveValue('Europe/London');
  });

  it('surfaces non-validation save failures and allows retry', async () => {
    let patchAttempts = 0;
    mockApi({
      ...settingsHandlers(),
      'PATCH /orgs/acme/settings': () => {
        patchAttempts += 1;
        if (patchAttempts === 1) return problem(500, 'internal_error');
        return json({ ...ORG_SETTINGS, timezone: 'Europe/Berlin' });
      },
    });
    renderApp('/o/acme/admin/general');
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByLabelText('Timezone'), 'Europe/Berlin');
    await user.click(screen.getByRole('button', { name: 'Save preferences' }));
    expect(await screen.findByText(/something went wrong/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Timezone')).toHaveValue('Europe/Berlin');
    await user.click(screen.getByRole('button', { name: 'Save preferences' }));
    expect(await screen.findByText('Regional preferences saved.')).toBeInTheDocument();
    expect(patchAttempts).toBe(2);
  });

  it('refetches settings after a successful save', async () => {
    let settingsGets = 0;
    mockApi({
      ...settingsHandlers(),
      'GET /orgs/acme/settings': () => {
        settingsGets += 1;
        return json(ORG_SETTINGS);
      },
      'PATCH /orgs/acme/settings': () =>
        json({ ...ORG_SETTINGS, locale: 'fr-FR', updated_at: '2026-10-28T00:00:00Z' }),
    });
    renderApp('/o/acme/admin/general');
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByLabelText('Locale'), 'fr-FR');
    await user.click(screen.getByRole('button', { name: 'Save preferences' }));
    await screen.findByText('Regional preferences saved.');
    await waitFor(() => {
      expect(settingsGets).toBeGreaterThanOrEqual(2);
    });
  });

  it('displays stored timezone and locale after reload', async () => {
    mockApi({
      ...settingsHandlers(),
      'GET /orgs/acme/settings': () =>
        json({
          timezone: 'Asia/Tokyo',
          locale: 'ja-JP',
          story_points_enabled: true,
          story_points_max: 100,
          updated_at: '2026-10-27T00:00:00Z',
        }),
    });
    renderApp('/o/acme/admin/general');
    expect(await screen.findByLabelText('Timezone')).toHaveValue('Asia/Tokyo');
    expect(screen.getByLabelText('Locale')).toHaveValue('ja-JP');
  });

  it('includes non-catalog locale values in the selector', async () => {
    mockApi({
      ...settingsHandlers(),
      'GET /orgs/acme/settings': () =>
        json({
          timezone: 'UTC',
          locale: 'en-u-ca-gregory',
          story_points_enabled: true,
          story_points_max: 100,
          updated_at: '2026-10-27T00:00:00Z',
        }),
    });
    renderApp('/o/acme/admin/general');
    expect(await screen.findByLabelText('Locale')).toHaveValue('en-u-ca-gregory');
  });
});
