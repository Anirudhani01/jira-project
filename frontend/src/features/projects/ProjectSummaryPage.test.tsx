import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';

import { createQueryClient } from '../../lib/queryClient';
import { json, mockApi, problem, renderApp, SIGNED_IN } from '../../test/api';

import { useProjectSummary } from './api';

const SESSION = {
  ...SIGNED_IN,
  user: { ...SIGNED_IN.user, email_verified: true },
  orgs: [{ slug: 'acme', name: 'Acme', role: 'member' }],
};
const PROJECT = {
  id: '33333333-3333-3333-3333-333333333333',
  key: 'WEB',
  name: 'Website',
  description: null,
  board_type: 'kanban',
  archived: false,
  my_role: 'member',
  permissions: ['issue.create', 'issue.edit', 'project.view'],
  created_at: '2026-10-27T00:00:00Z',
};
const SUMMARY = {
  total: 12,
  unassigned: 3,
  by_status: [
    { status_id: 's1', name: 'To Do', category: 'todo', count: 5 },
    { status_id: 's2', name: 'In Progress', category: 'in_progress', count: 2 },
    { status_id: 's3', name: 'In Review', category: 'in_progress', count: 1 },
    { status_id: 's4', name: 'Done', category: 'done', count: 4 },
  ],
  by_type: [
    { type_id: 't-bug', name: 'Bug', kind: 'standard', active: true, count: 4 },
    { type_id: 't-task', name: 'Task', kind: 'standard', active: true, count: 7 },
    { type_id: 't-epic', name: 'Epic', kind: 'epic', active: false, count: 1 },
  ],
  by_priority: [
    { priority_id: 'p-high', name: 'High', active: true, count: 2 },
    { priority_id: 'p-med', name: 'Medium', active: true, count: 10 },
    { priority_id: 'p-low', name: 'Low', active: true, count: 0 },
  ],
};
const EMPTY = {
  total: 0,
  unassigned: 0,
  by_status: SUMMARY.by_status.map((status) => ({ ...status, count: 0 })),
  by_type: SUMMARY.by_type.map((row) => ({ ...row, count: 0 })),
  by_priority: SUMMARY.by_priority.map((row) => ({ ...row, count: 0 })),
};
const SUMMARY_PATH = 'GET /orgs/acme/projects/WEB/summary';

function config(summary: unknown, project: Record<string, unknown> = {}) {
  return {
    'GET /auth/session': () => json(SESSION),
    'GET /orgs/acme/projects/WEB': () => json({ ...PROJECT, ...project }),
    [SUMMARY_PATH]: () => json(summary),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('project summary page', () => {
  it('shows the headline numbers, the status split and where each number leads', async () => {
    mockApi(config(SUMMARY));
    renderApp('/o/acme/p/WEB/summary');

    expect(await screen.findByRole('heading', { level: 1, name: 'WEB summary' })).toBeVisible();
    expect(screen.getByText(/including the backlog, epics and sub-tasks/)).toBeVisible();

    // Headline numbers are links to the same filter in the issue list.
    const total = screen.getByRole('link', { name: /Total issues 12/ });
    expect(total).toHaveAttribute('href', '/o/acme/p/WEB/issues');
    const done = screen.getByRole('link', { name: /Done 4 33% of all issues/ });
    expect(done).toHaveAttribute('href', '/o/acme/p/WEB/issues?status_category=done');
    const unassigned = screen.getByRole('link', { name: /Unassigned 3/ });
    expect(unassigned).toHaveAttribute('href', '/o/acme/p/WEB/issues?assignee=none');

    // The bar says the whole split in words.
    expect(
      screen.getByRole('img', { name: '12 issues: 5 to do, 3 in progress, 4 done' }),
    ).toBeInTheDocument();

    // The table lists every status with its count and share, grouped by category.
    const table = screen.getByRole('table', { name: /Issues by status/ });
    const review = within(table).getByRole('row', { name: /In Review/ });
    expect(within(review).getByText('1')).toBeInTheDocument();
    expect(within(review).getByText('8%')).toBeInTheDocument();
    for (const link of screen.getAllByRole('link', { name: /In progress/ })) {
      expect(link).toHaveAttribute('href', '/o/acme/p/WEB/issues?status_category=in_progress');
    }
  });

  it('ranks issue types by count and keeps priorities in severity order, each as a link', async () => {
    mockApi(config(SUMMARY));
    renderApp('/o/acme/p/WEB/summary');

    const types = await screen.findByRole('region', { name: 'Issue types' });
    const typeRows = within(types).getAllByRole('link');
    expect(typeRows.map((row) => row.textContent.replace(/\s+/g, ' ').trim())).toEqual([
      'Task 7',
      'Bug 4',
      'Epic (inactive) 1',
    ]);
    expect(typeRows[0]).toHaveAttribute('href', '/o/acme/p/WEB/issues?type=t-task');

    const priorities = screen.getByRole('region', { name: 'Priorities' });
    const priorityRows = within(priorities).getAllByRole('link');
    expect(priorityRows.map((row) => row.textContent.replace(/\s+/g, ' ').trim())).toEqual([
      'High 2',
      'Medium 10',
      'Low 0',
    ]);
    expect(priorityRows[0]).toHaveAttribute('href', '/o/acme/p/WEB/issues?priority=p-high');
  });

  it('has a Summary tab on the project, marked as the current page', async () => {
    mockApi(config(SUMMARY));
    renderApp('/o/acme/p/WEB/summary');
    const nav = await screen.findByRole('navigation', { name: 'Project' });
    const tab = within(nav).getByRole('link', { name: 'Summary' });
    expect(tab).toHaveAttribute('aria-current', 'page');
    expect(tab).toHaveAttribute('href', '/o/acme/p/WEB/summary');
  });

  it('offers to create the first issue when the project is empty', async () => {
    mockApi(config(EMPTY));
    renderApp('/o/acme/p/WEB/summary');
    expect(await screen.findByRole('heading', { name: 'No issues yet' })).toBeVisible();
    expect(screen.queryByRole('img', { name: /issues:/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Create issue' }));
    expect(await screen.findByRole('dialog')).toBeVisible();
  });

  it('shows the empty state without a create button for someone who cannot create issues', async () => {
    mockApi(config(EMPTY, { permissions: ['project.view'] }));
    renderApp('/o/acme/p/WEB/summary');
    expect(await screen.findByRole('heading', { name: 'No issues yet' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Create issue' })).not.toBeInTheDocument();
  });

  it('has no create button on an archived project', async () => {
    mockApi(config(EMPTY, { archived: true }));
    renderApp('/o/acme/p/WEB/summary');
    expect(await screen.findByRole('heading', { name: 'No issues yet' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Create issue' })).not.toBeInTheDocument();
  });

  it('shows an error with a retry when the counts cannot be loaded', async () => {
    let fail = true;
    mockApi({
      ...config(SUMMARY),
      [SUMMARY_PATH]: () => (fail ? problem(500, 'internal_error') : json(SUMMARY)),
    });
    renderApp('/o/acme/p/WEB/summary');
    const retry = await screen.findByRole('button', { name: /try again|retry/i });
    fail = false;
    await userEvent.click(retry);
    expect(await screen.findByRole('img', { name: /12 issues/ })).toBeInTheDocument();
  });

  it('shows the not-found page for a project that does not exist', async () => {
    mockApi({
      'GET /auth/session': () => json(SESSION),
      'GET /orgs/acme/projects/WEB': () => problem(404, 'not_found'),
      [SUMMARY_PATH]: () => problem(404, 'not_found'),
    });
    renderApp('/o/acme/p/WEB/summary');
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'WEB summary' })).not.toBeInTheDocument();
    });
    expect(
      await screen.findByRole('heading', { name: /not found|doesn.t exist|404/i }),
    ).toBeVisible();
  });
});

describe('useProjectSummary', () => {
  it('asks the server again every time the page opens, even within the default stale time', async () => {
    const calls = mockApi(config(SUMMARY));
    const client = createQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const first = renderHook(() => useProjectSummary('acme', 'WEB'), { wrapper });
    await waitFor(() => {
      expect(first.result.current.isSuccess).toBe(true);
    });
    first.unmount();
    const second = renderHook(() => useProjectSummary('acme', 'WEB'), { wrapper });
    await waitFor(() => {
      expect(second.result.current.isFetching).toBe(false);
    });
    const requests = calls.filter((call) => call.path === '/orgs/acme/projects/WEB/summary');
    expect(requests).toHaveLength(2);
  });
});
