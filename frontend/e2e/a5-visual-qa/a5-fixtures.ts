import type { Page } from '@playwright/test';

export type OrgSettingsFixture = {
  timezone: string;
  locale: string;
  updated_at: string;
};

export const A5_ORG_SLUG = 'acme';

export const A5_SESSION = {
  user: {
    id: '11111111-1111-1111-1111-111111111111',
    email: 'owner@example.com',
    display_name: 'Owner User',
    email_verified: true,
  },
  csrf_token: 'csrf-a5-e2e',
  session: { id: 's1', expires_at: '2030-01-01T00:00:00Z' },
  orgs: [{ slug: A5_ORG_SLUG, name: 'Acme', role: 'owner' }],
};

export const A5_ORG_OWNER = {
  id: '22222222-2222-2222-2222-222222222222',
  slug: A5_ORG_SLUG,
  name: 'Acme',
  role: 'owner',
  permissions: ['org.view', 'org.manage', 'org.members.manage', 'org.audit.view'],
  created_at: '2026-10-27T00:00:00Z',
};

export const A5_AUDIT_EVENT = {
  id: 9001,
  action: 'org.settings.updated',
  actor_user_id: '11111111-1111-1111-1111-111111111111',
  outcome: 'success',
  target_type: 'organization',
  target_id: A5_ORG_OWNER.id,
  ip: null,
  user_agent: null,
  request_id: null,
  metadata: { fields: ['timezone'] },
  created_at: '2026-06-15T18:30:00.000Z',
};

export const A5_AUTH_ACTIVITY_ITEM = {
  id: 8001,
  user_id: '11111111-1111-1111-1111-111111111111',
  member_display_name: 'Owner User',
  member_status: 'active' as const,
  event_type: 'auth.login.succeeded',
  outcome: 'success',
  reason: 'ok',
  metadata: { sessions_evicted: 0, rehashed: false },
  occurred_at: '2026-06-15T18:30:00.000Z',
};

export type A5MockOptions = {
  settings: OrgSettingsFixture;
  onSettingsGet?: () => void;
  onSettingsPatch?: (body: unknown) => OrgSettingsFixture | null;
};

/** Deterministic catch-all API mock for A5 browser verification. */
export async function installA5OrgMocks(page: Page, options: A5MockOptions) {
  let settings = { ...options.settings };
  const settingsGets: string[] = [];

  await page.route('**/api/v1/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const apiPath = url.pathname.replace(/^\/api\/v1/, '');
    const method = req.method().toUpperCase();

    const fulfill = (status: number, body: unknown) =>
      route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(body),
      });

    if (method === 'GET' && apiPath === '/auth/session') {
      await fulfill(200, A5_SESSION);
      return;
    }
    if (method === 'GET' && apiPath === `/orgs/${A5_ORG_SLUG}`) {
      await fulfill(200, A5_ORG_OWNER);
      return;
    }
    if (method === 'GET' && apiPath === `/orgs/${A5_ORG_SLUG}/settings`) {
      settingsGets.push(new Date().toISOString());
      options.onSettingsGet?.();
      await fulfill(200, settings);
      return;
    }
    if (method === 'PATCH' && apiPath === `/orgs/${A5_ORG_SLUG}/settings`) {
      const body = req.postDataJSON() as { timezone?: string; locale?: string };
      const patched = options.onSettingsPatch?.(body);
      if (patched) {
        settings = patched;
      } else {
        settings = {
          ...settings,
          ...(body.timezone ? { timezone: body.timezone } : {}),
          ...(body.locale ? { locale: body.locale } : {}),
          updated_at: '2026-10-28T00:00:00Z',
        };
      }
      await fulfill(200, settings);
      return;
    }
    if (method === 'GET' && apiPath === `/orgs/${A5_ORG_SLUG}/notifications/unread-count`) {
      await fulfill(200, { count: 0 });
      return;
    }
    if (method === 'GET' && apiPath === `/orgs/${A5_ORG_SLUG}/members`) {
      await fulfill(200, {
        items: [
          {
            user_id: '11111111-1111-1111-1111-111111111111',
            display_name: 'Owner User',
            email: 'owner@example.com',
            role: 'owner',
            can_create_projects: true,
            joined_at: '2026-01-01T00:00:00Z',
          },
        ],
      });
      return;
    }
    if (method === 'GET' && apiPath === `/orgs/${A5_ORG_SLUG}/projects`) {
      await fulfill(200, { items: [] });
      return;
    }
    if (method === 'GET' && apiPath.startsWith(`/orgs/${A5_ORG_SLUG}/audit-events`)) {
      await fulfill(200, { items: [A5_AUDIT_EVENT], next_cursor: null });
      return;
    }
    if (method === 'GET' && apiPath.startsWith(`/orgs/${A5_ORG_SLUG}/authentication-activity`)) {
      await fulfill(200, { items: [A5_AUTH_ACTIVITY_ITEM], next_cursor: null });
      return;
    }

    await fulfill(404, { status: 404, code: 'not_found', title: 'not_found' });
  });

  return {
    getSettingsGetCount: () => settingsGets.length,
    getSettings: () => settings,
  };
}
