import type { Page } from '@playwright/test';

/** Shared org/project identifiers for A4a browser regression (mocked API only). */
export const A4A_ORG_SLUG = 'acme-a4a-workflow';
export const A4A_PROJECT_KEY = 'WEB';
export const A4A_USER_ID = '11111111-1111-1111-1111-111111111111';
export const A4A_ORG_ID = '22222222-2222-2222-2222-222222222222';
export const A4A_PROJECT_ID = '33333333-3333-3333-3333-333333333333';

export const A4A_OWNER_PERMISSIONS = [
  'org.view',
  'org.manage',
  'org.audit.view',
  'org.members.manage',
  'project.create',
] as const;

export const A4A_MEMBER_PERMISSIONS = ['org.view'] as const;

const STATUS_TODO = '44444444-4444-4444-4444-444444444441';
export const STATUS_PROGRESS = '44444444-4444-4444-4444-444444444442';
const STATUS_DONE = '44444444-4444-4444-4444-444444444443';
const COL_TODO = '55555555-5555-5555-5555-555555555551';
const COL_DONE = '55555555-5555-5555-5555-555555555552';

/** Workflow payload aligned with `WorkflowResponse` (integration tests use the same shape). */
export const A4A_WORKFLOW = {
  name: 'Default workflow',
  revision: 1,
  initial_status_id: STATUS_TODO,
  statuses: [
    { id: STATUS_TODO, name: 'To Do', category: 'todo', position: 0 },
    { id: STATUS_PROGRESS, name: 'In Progress', category: 'in_progress', position: 1 },
    { id: STATUS_DONE, name: 'Done', category: 'done', position: 2 },
  ],
  transitions: [
    {
      id: '66666666-6666-6666-6666-666666666661',
      name: 'Start work',
      from_status_id: STATUS_TODO,
      to_status_id: STATUS_PROGRESS,
    },
    {
      id: '66666666-6666-6666-6666-666666666662',
      name: 'Close',
      from_status_id: null,
      to_status_id: STATUS_DONE,
    },
  ],
  columns: [
    { name: 'To Do', position: 0, status_ids: [STATUS_TODO] },
    { name: 'Done', position: 1, status_ids: [STATUS_DONE] },
  ],
};

export const A4A_BOARD = {
  project_key: A4A_PROJECT_KEY,
  board_type: 'kanban',
  truncated: false,
  sprint: null,
  transitions: [],
  columns: [
    {
      id: COL_TODO,
      name: 'To Do',
      position: 0,
      wip_limit: null,
      status_ids: [STATUS_TODO, STATUS_PROGRESS],
      count: 0,
      over_wip_limit: false,
      issues: [],
    },
    {
      id: COL_DONE,
      name: 'Done',
      position: 1,
      wip_limit: 3,
      status_ids: [STATUS_DONE],
      count: 0,
      over_wip_limit: false,
      issues: [],
    },
  ],
};

export type A4aProjectSummary = {
  key: string;
  name: string;
  board_type: 'kanban' | 'scrum';
  archived: boolean;
  my_role: string;
};

export type A4aMockTelemetry = {
  /** Shell `GET /projects` without `archived=true`. */
  shellActiveProjectListGets: number;
  /** Hub-only `GET /projects?archived=true` (AuthorizedAdminWorkflowHub). */
  hubArchivedProjectListGets: number;
  workflowGets: string[];
  boardColumnPutBodies: unknown[];
  workflowPutBodies: unknown[];
  workflowPutHeaders: string[];
};

export type A4aMockContext = {
  orgSlug: string;
  orgName: string;
  role: 'owner' | 'admin' | 'member';
  permissions: readonly string[];
  displayName: string;
  activeProjects: A4aProjectSummary[];
  archivedProjects: A4aProjectSummary[];
  projectPermissions: string[];
  telemetry: A4aMockTelemetry;
};

export function createA4aMockContext(
  overrides: Partial<Omit<A4aMockContext, 'telemetry'>> & {
    telemetry?: Partial<A4aMockTelemetry>;
  } = {},
): A4aMockContext {
  return {
    orgSlug: A4A_ORG_SLUG,
    orgName: 'Acme A4a QA',
    role: 'owner',
    permissions: A4A_OWNER_PERMISSIONS,
    displayName: 'Owner User',
    activeProjects: [
      {
        key: A4A_PROJECT_KEY,
        name: 'Shop (Kanban)',
        board_type: 'kanban',
        archived: false,
        my_role: 'admin',
      },
    ],
    archivedProjects: [],
    projectPermissions: [
      'project.view',
      'project.manage',
      'board.manage',
      'project.members.manage',
    ],
    telemetry: {
      shellActiveProjectListGets: 0,
      hubArchivedProjectListGets: 0,
      workflowGets: [],
      boardColumnPutBodies: [],
      workflowPutBodies: [],
      workflowPutHeaders: [],
      ...overrides.telemetry,
    },
    ...overrides,
  };
}

function notFound() {
  return {
    type: 'urn:problem:not_found',
    title: 'Not found',
    status: 404,
    code: 'not_found',
    detail: 'The requested resource was not found.',
  };
}

/**
 * Single Playwright router for A4a UI tests. Unhandled API paths return 404 problem JSON
 * so requests never reach a live backend (which would trigger Session expired UX).
 */
export type WorkflowPutInterceptor = (args: {
  req: import('@playwright/test').Request;
  fulfill: (status: number, body: unknown) => Promise<void>;
  body: unknown;
  attempt: number;
}) => Promise<'handled' | 'fallthrough'>;

export async function installA4aMockRouter(
  page: Page,
  ctx: A4aMockContext,
  options?: { workflowPut?: WorkflowPutInterceptor },
): Promise<void> {
  await page.route('**/api/v1/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const apiPath = url.pathname.replace(/^\/api\/v1/, '');
    const method = req.method().toUpperCase();

    const fulfill = async (status: number, body: unknown) => {
      await route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(body),
      });
    };

    if (method === 'GET' && apiPath === '/auth/session') {
      await fulfill(200, {
        user: {
          id: A4A_USER_ID,
          email: 'owner@example.com',
          display_name: ctx.displayName,
          email_verified: true,
        },
        csrf_token: 'e2e-csrf-a4a',
        session: { id: 'sess-a4a', expires_at: '2030-01-01T00:00:00Z' },
        orgs: [{ slug: ctx.orgSlug, name: ctx.orgName, role: ctx.role }],
      });
      return;
    }

    const orgPrefix = `/orgs/${ctx.orgSlug}`;
    if (method === 'GET' && apiPath === orgPrefix) {
      await fulfill(200, {
        id: A4A_ORG_ID,
        slug: ctx.orgSlug,
        name: ctx.orgName,
        role: ctx.role,
        permissions: [...ctx.permissions],
        created_at: '2026-01-01T00:00:00Z',
      });
      return;
    }

    if (method === 'GET' && apiPath === `${orgPrefix}/members`) {
      await fulfill(200, {
        items: [
          {
            user_id: A4A_USER_ID,
            display_name: ctx.displayName,
            email: 'owner@example.com',
            role: ctx.role,
            can_create_projects: ctx.permissions.includes('project.create'),
            joined_at: '2026-01-01T00:00:00Z',
          },
        ],
      });
      return;
    }

    if (method === 'GET' && apiPath === `${orgPrefix}/notifications/unread-count`) {
      await fulfill(200, { count: 0 });
      return;
    }

    if (method === 'GET' && apiPath === `${orgPrefix}/projects`) {
      const archived = url.searchParams.get('archived') === 'true';
      if (archived) {
        ctx.telemetry.hubArchivedProjectListGets += 1;
        await fulfill(200, { items: ctx.archivedProjects });
      } else {
        ctx.telemetry.shellActiveProjectListGets += 1;
        await fulfill(200, { items: ctx.activeProjects });
      }
      return;
    }

    const projectPrefix = `${orgPrefix}/projects/${A4A_PROJECT_KEY}`;
    if (method === 'GET' && apiPath === projectPrefix) {
      await fulfill(200, {
        id: A4A_PROJECT_ID,
        key: A4A_PROJECT_KEY,
        name: 'Shop (Kanban)',
        description: null,
        board_type: 'kanban',
        archived: false,
        my_role: 'admin',
        permissions: [...ctx.projectPermissions],
        created_at: '2026-01-01T00:00:00Z',
      });
      return;
    }

    if (method === 'GET' && apiPath === `${projectPrefix}/workflow`) {
      ctx.telemetry.workflowGets.push(A4A_PROJECT_KEY);
      await fulfill(200, A4A_WORKFLOW);
      return;
    }

    if (method === 'GET' && apiPath === `${projectPrefix}/members`) {
      await fulfill(200, { items: [] });
      return;
    }

    if (method === 'GET' && apiPath === `${projectPrefix}/board`) {
      await fulfill(200, A4A_BOARD);
      return;
    }

    if (method === 'PUT' && apiPath === `${projectPrefix}/board/columns`) {
      const body = req.postDataJSON();
      ctx.telemetry.boardColumnPutBodies.push(body);
      await fulfill(200, A4A_BOARD);
      return;
    }

    if (method === 'PUT' && apiPath === `${projectPrefix}/workflow`) {
      const body = req.postDataJSON();
      ctx.telemetry.workflowPutBodies.push(body);
      ctx.telemetry.workflowPutHeaders.push(req.headers()['if-match'] ?? '');
      if (options?.workflowPut) {
        const attempt = ctx.telemetry.workflowPutBodies.length;
        const result = await options.workflowPut({ req, fulfill, body, attempt });
        if (result === 'handled') return;
      }
      await fulfill(200, { ...A4A_WORKFLOW, revision: 2, ...(body as { name?: string }) });
      return;
    }

    await fulfill(404, notFound());
  });
}

export function resetA4aTelemetry(ctx: A4aMockContext): void {
  ctx.telemetry.shellActiveProjectListGets = 0;
  ctx.telemetry.hubArchivedProjectListGets = 0;
  ctx.telemetry.workflowGets = [];
  ctx.telemetry.boardColumnPutBodies = [];
  ctx.telemetry.workflowPutBodies = [];
  ctx.telemetry.workflowPutHeaders = [];
}

export { COL_TODO, COL_DONE, STATUS_TODO, STATUS_DONE };
