import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { json, mockApi, problem, renderApp, SIGNED_IN } from '../../test/api';

const SESSION = {
  ...SIGNED_IN,
  user: { ...SIGNED_IN.user, email_verified: true },
  orgs: [{ slug: 'acme', name: 'Acme', role: 'member' }],
};
const S1 = '44444444-4444-4444-4444-444444444441';
const S2 = '44444444-4444-4444-4444-444444444442';
const C1 = '55555555-5555-5555-5555-555555555551';
const C2 = '55555555-5555-5555-5555-555555555552';

const PROJECT = {
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

const WORKFLOW = {
  name: 'Default workflow',
  revision: 1,
  initial_status_id: S1,
  statuses: [
    { id: S1, name: 'To Do', category: 'todo', position: 0 },
    { id: S2, name: 'Done', category: 'done', position: 1 },
  ],
  transitions: [
    {
      id: '66666666-6666-6666-6666-666666666661',
      name: 'Finish',
      from_status_id: S1,
      to_status_id: S2,
    },
  ],
  columns: [
    { name: 'To Do', position: 0, status_ids: [S1] },
    { name: 'Done', position: 1, status_ids: [S2] },
  ],
};

const BOARD = {
  project_key: 'WEB',
  board_type: 'kanban',
  truncated: false,
  sprint: null,
  transitions: [],
  columns: [
    {
      id: C1,
      name: 'To Do',
      position: 0,
      wip_limit: null,
      status_ids: [S1],
      count: 0,
      over_wip_limit: false,
      issues: [],
    },
    {
      id: C2,
      name: 'Done',
      position: 1,
      wip_limit: 3,
      status_ids: [S2],
      count: 0,
      over_wip_limit: false,
      issues: [],
    },
  ],
};

function baseApi(extra: Record<string, () => Response> = {}) {
  return mockApi({
    'GET /auth/session': () => json(SESSION),
    'GET /orgs/acme/projects/WEB': () => json(PROJECT),
    'GET /orgs/acme/projects/WEB/workflow': () => json(WORKFLOW),
    'GET /orgs/acme/projects/WEB/members': () => json({ items: [] }),
    'GET /orgs/acme/projects/WEB/board': () => json(BOARD),
    ...extra,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Project workflow editor', () => {
  it('keeps Save disabled until the draft changes, then after discard and successful save', async () => {
    const calls = baseApi({
      'PUT /orgs/acme/projects/WEB/workflow': () =>
        json({ ...WORKFLOW, revision: 2, name: 'Saved name' }),
    });
    renderApp('/o/acme/p/WEB?tab=workflow');
    const user = userEvent.setup();
    const nameInput = await screen.findByLabelText('Workflow name');
    const save = screen.getByRole('button', { name: 'Save workflow' });
    expect(save).toBeDisabled();
    await user.clear(nameInput);
    await user.type(nameInput, 'Edited');
    expect(save).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Discard' }));
    expect(nameInput).toHaveValue('Default workflow');
    expect(save).toBeDisabled();
    await user.clear(nameInput);
    await user.type(nameInput, 'Saved name');
    await user.click(save);
    await waitFor(() => {
      expect(calls.some((c) => c.method === 'PUT')).toBe(true);
    });
    expect(await screen.findByText('Workflow saved')).toBeInTheDocument();
    await waitFor(() => {
      expect(save).toBeDisabled();
    });
  });

  it('enables Save after status_in_use replacement is applied to the draft', async () => {
    baseApi({
      'PUT /orgs/acme/projects/WEB/workflow': () =>
        problem(422, 'status_in_use', {
          detail: 'Provide status_remaps for statuses that still have issues.',
        }),
    });
    renderApp('/o/acme/p/WEB?tab=workflow');
    const user = userEvent.setup();
    await screen.findByLabelText('Workflow name');
    const save = screen.getByRole('button', { name: 'Save workflow' });
    expect(save).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Delete status Done' }));
    await user.click(screen.getByRole('button', { name: 'Remove from draft' }));
    expect(save).toBeEnabled();
    await user.click(save);
    expect(await screen.findByText(/Issues still use a removed status/)).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText(/Replacement status for/), S1);
    expect(save).toBeEnabled();
  });

  it('saves with If-Match and keeps draft on 412', async () => {
    const calls = baseApi({
      'PUT /orgs/acme/projects/WEB/workflow': () => problem(412, 'workflow_revision_conflict'),
    });
    renderApp('/o/acme/p/WEB?tab=workflow');
    const user = userEvent.setup();
    const nameInput = await screen.findByLabelText('Workflow name');
    await user.clear(nameInput);
    await user.type(nameInput, 'Updated name');
    await user.click(screen.getByRole('button', { name: 'Save workflow' }));
    expect(await screen.findByText(/Someone else updated this workflow/)).toBeInTheDocument();
    expect(nameInput).toHaveValue('Updated name');
    const put = calls.find((c) => c.method === 'PUT');
    expect(put?.headers.get('If-Match')).toBe('"w1"');
    expect((put?.body as { name: string }).name).toBe('Updated name');
  });

  it('shows status_in_use remediation and sends status_remaps on second save', async () => {
    let attempts = 0;
    const calls = baseApi({
      'PUT /orgs/acme/projects/WEB/workflow': () => {
        attempts += 1;
        if (attempts === 1) {
          return problem(422, 'status_in_use', {
            detail: 'Provide status_remaps for statuses that still have issues.',
          });
        }
        return json({ ...WORKFLOW, revision: 2, name: WORKFLOW.name });
      },
    });
    renderApp('/o/acme/p/WEB?tab=workflow');
    const user = userEvent.setup();
    await screen.findByLabelText('Workflow name');
    await user.click(screen.getByRole('button', { name: 'Delete status Done' }));
    await user.click(screen.getByRole('button', { name: 'Remove from draft' }));
    await user.click(screen.getByRole('button', { name: 'Save workflow' }));
    expect(await screen.findByText(/Issues still use a removed status/)).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText(/Replacement status for/), S1);
    await user.click(screen.getByRole('button', { name: 'Apply remapping to draft' }));
    await user.click(screen.getByRole('button', { name: 'Save workflow' }));
    await waitFor(() => {
      expect(calls.filter((c) => c.method === 'PUT').length).toBe(2);
    });
    const second = calls.filter((c) => c.method === 'PUT')[1];
    expect((second?.body as { status_remaps: unknown[] }).status_remaps).toEqual([
      { from_status_id: S2, to_status_id: S1 },
    ]);
  });

  it('hides column save on the columns tab for managers', async () => {
    baseApi();
    renderApp('/o/acme/p/WEB?tab=columns');
    expect(await screen.findByRole('link', { name: 'Workflow' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save columns' })).toBeNull();
    expect(screen.getByLabelText('Column 1 name')).toBeDisabled();
  });

  it('preserves column ids when reordering before save', async () => {
    const calls = baseApi({
      'PUT /orgs/acme/projects/WEB/workflow': () => json({ ...WORKFLOW, revision: 2 }),
    });
    renderApp('/o/acme/p/WEB?tab=workflow');
    const user = userEvent.setup();
    await screen.findByLabelText('Workflow name');
    const moveDown = screen
      .getAllByRole('button', { name: 'Move column down' })
      .find((el) => !el.hasAttribute('disabled'));
    expect(moveDown).toBeDefined();
    await user.click(moveDown as HTMLElement);
    await user.click(screen.getByRole('button', { name: 'Save workflow' }));
    await waitFor(() => {
      expect(calls.some((c) => c.method === 'PUT')).toBe(true);
    });
    const put = calls.find((c) => c.method === 'PUT');
    const body = put?.body as { columns: { id?: string }[] };
    expect(body.columns.map((c) => c.id).sort()).toEqual([C1, C2].sort());
  });
});
