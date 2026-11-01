import { screen, waitFor } from '@testing-library/react';

import issueActivitySectionSource from '../issues/IssueActivitySection.tsx?raw';

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
const ORG_SETTINGS = {
  timezone: 'UTC',
  locale: 'en-US',
  story_points_enabled: true,
  story_points_max: 100,
  updated_at: '2026-10-27T00:00:00Z',
};

describe('A5 formatter integration', () => {
  it('issues a single org settings GET on General settings (shared orgSettingsKey)', async () => {
    const calls = mockApi({
      'GET /auth/session': () => json(SESSION),
      'GET /orgs/acme': () => json(ORG_OWNER),
      'GET /orgs/acme/notifications/unread-count': () => json({ count: 0 }),
      'GET /orgs/acme/settings': () => json(ORG_SETTINGS),
    });
    renderApp('/o/acme/admin/general');
    await screen.findByLabelText('Timezone');
    await waitFor(() => {
      const settingsGets = calls.filter(
        (c) => c.method === 'GET' && c.path === '/orgs/acme/settings',
      );
      expect(settingsGets.length).toBe(1);
    });
  });

  it('does not fetch organization settings on the account page', async () => {
    const calls = mockApi({
      'GET /auth/session': () => json(SESSION),
      'GET /auth/sessions': () => json({ items: [] }),
    });
    renderApp('/account');
    await screen.findByRole('heading', { name: /account/i });
    expect(calls.some((c) => c.path.includes('/orgs/') && c.path.endsWith('/settings'))).toBe(
      false,
    );
  });

  it('leaves deferred issue activity on lib/relativeTime (outside approved migration)', () => {
    expect(issueActivitySectionSource).toContain("from '../../lib/relativeTime'");
    expect(issueActivitySectionSource).not.toContain('useOrgFormatters');
  });
});
