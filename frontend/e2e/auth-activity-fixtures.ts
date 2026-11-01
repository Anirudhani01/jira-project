import type { Page, Route } from '@playwright/test';

/** Synthetic payloads conforming to Phase 4 AuthenticationActivityItem (allowlisted metadata only). */
export type AuthActivityItem = {
  id: number;
  user_id: string;
  member_display_name: string;
  member_status: 'active' | 'removed';
  event_type: string;
  outcome: string;
  reason: string | null;
  metadata: Record<string, unknown>;
  occurred_at: string;
};

export const E2E_OWNER_USER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
export const E2E_FORMER_USER_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

export function loginSucceededItem(overrides: Partial<AuthActivityItem> = {}): AuthActivityItem {
  return {
    id: 1001,
    user_id: E2E_OWNER_USER_ID,
    member_display_name: 'Owner User',
    member_status: 'active',
    event_type: 'auth.login.succeeded',
    outcome: 'success',
    reason: 'ok',
    metadata: { sessions_evicted: 2, rehashed: false },
    occurred_at: '2026-10-30T12:00:00.000Z',
    ...overrides,
  };
}

export function logoutItem(overrides: Partial<AuthActivityItem> = {}): AuthActivityItem {
  return {
    id: 1000,
    user_id: E2E_OWNER_USER_ID,
    member_display_name: 'Owner User',
    member_status: 'active',
    event_type: 'auth.logout',
    outcome: 'success',
    reason: null,
    metadata: {},
    occurred_at: '2026-10-30T11:00:00.000Z',
    ...overrides,
  };
}

export function formerMemberItem(): AuthActivityItem {
  return loginSucceededItem({
    id: 1002,
    user_id: E2E_FORMER_USER_ID,
    member_display_name: 'Former Teammate',
    member_status: 'removed',
    metadata: { sessions_evicted: 1, rehashed: true },
    occurred_at: '2026-09-01T09:30:00.000Z',
  });
}

export type ActivityRouteHandler = (url: URL) => {
  status?: number;
  body?: { items: AuthActivityItem[]; next_cursor: string | null };
  delayMs?: number;
};

export async function mockAuthenticationActivityApi(
  page: Page,
  handler: ActivityRouteHandler,
): Promise<{ calls: URL[] }> {
  const calls: URL[] = [];
  await page.route('**/api/v1/orgs/*/authentication-activity**', async (route: Route) => {
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }
    const url = new URL(route.request().url());
    calls.push(url);
    const result = handler(url);
    if (result.delayMs) {
      await new Promise((resolve) => setTimeout(resolve, result.delayMs));
    }
    if (result.status && result.status >= 400) {
      await route.fulfill({
        status: result.status,
        contentType: 'application/json',
        body: JSON.stringify({
          status: result.status,
          code: 'server_error',
          title: 'server_error',
          detail: 'simulated failure for e2e',
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(result.body ?? { items: [], next_cursor: null }),
    });
  });
  return { calls };
}

/** Strings that must never appear in the UI (Phase 4 privacy contract). */
const OWNER_PERMISSIONS = [
  'org.view',
  'org.manage',
  'org.audit.view',
  'org.members.manage',
  'project.create',
];
const MEMBER_PERMISSIONS = ['org.view'];

export async function mockSignedInOrgContext(
  page: Page,
  opts: {
    orgSlug: string;
    orgName?: string;
    role: 'owner' | 'admin' | 'member';
    permissions: string[];
    displayName?: string;
    members?: { user_id: string; display_name: string; role: string }[];
  },
) {
  const userId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const orgName = opts.orgName ?? 'Acme E2E';
  const members = opts.members ?? [
    {
      user_id: userId,
      display_name: opts.displayName ?? 'Owner User',
      role: opts.role,
    },
  ];

  await page.route('**/api/v1/auth/session', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        user: {
          id: userId,
          email: 'owner@example.com',
          display_name: opts.displayName ?? 'Owner User',
          email_verified: true,
        },
        csrf_token: 'e2e-csrf-token',
        session: { id: 'sess-e2e', expires_at: '2030-01-01T00:00:00Z' },
        orgs: [{ slug: opts.orgSlug, name: orgName, role: opts.role }],
      }),
    });
  });

  await page.route(`**/api/v1/orgs/${opts.orgSlug}`, async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: '22222222-2222-2222-2222-222222222222',
        slug: opts.orgSlug,
        name: orgName,
        role: opts.role,
        permissions: opts.permissions,
        created_at: '2026-01-01T00:00:00Z',
      }),
    });
  });

  await page.route(`**/api/v1/orgs/${opts.orgSlug}/members`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items: members.map((m) => ({
          ...m,
          email: `${m.user_id.slice(0, 8)}@example.com`,
          can_create_projects: true,
          joined_at: '2026-01-01T00:00:00Z',
        })),
      }),
    });
  });

  await page.route(`**/api/v1/orgs/${opts.orgSlug}/notifications/unread-count`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ count: 0 }),
    });
  });

  await page.route(`**/api/v1/orgs/${opts.orgSlug}/projects`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: [] }),
    });
  });
}

export { OWNER_PERMISSIONS, MEMBER_PERMISSIONS };

export const FORBIDDEN_UI_STRINGS = [
  '203.0.113.1',
  'SecretAgent',
  'email_hmac',
  'access_token',
  'refresh_token',
  'platform_event_id',
  'request_id',
  'password_hash',
  'simulated failure for e2e',
];
