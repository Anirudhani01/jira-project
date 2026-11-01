import { screen } from '@testing-library/react';

import { json, mockApi, problem, renderApp, SIGNED_IN } from '../../test/api';

const SESSION = {
  ...SIGNED_IN,
  user: { ...SIGNED_IN.user, email_verified: true },
  orgs: [{ slug: 'acme', name: 'Acme', role: 'owner' }],
};
const ISSUE = {
  id: '11111111-1111-1111-1111-111111111111',
  key: 'WEB-1',
  project_key: 'WEB',
  summary: 'Estimated',
  description: null,
  type: { id: 't1', name: 'Task', kind: 'standard' },
  status: { id: 's1', name: 'To Do', category: 'todo' },
  priority: { id: 'p1', name: 'Medium', color: '#888' },
  reporter: { id: 'u1', display_name: 'Ann' },
  assignee: null,
  parent: null,
  labels: [],
  sprint: null,
  story_points: 5,
  fix_version: null,
  version: 1,
  created_at: '2026-10-28T00:00:00Z',
  updated_at: '2026-10-28T00:00:00Z',
};

describe('Issue detail story points policy', () => {
  it('shows conflict banner when project settings GET returns 409', async () => {
    mockApi({
      'GET /auth/session': () => json(SESSION),
      'GET /orgs/acme/notifications/unread-count': () => json({ count: 0 }),
      'GET /orgs/acme/issues/WEB-1': () => json(ISSUE),
      'GET /orgs/acme/projects/WEB': () =>
        json({
          id: '33333333-3333-3333-3333-333333333333',
          key: 'WEB',
          name: 'Website',
          description: null,
          board_type: 'kanban',
          archived: false,
          my_role: 'admin',
          permissions: ['project.view', 'project.manage', 'issue.edit'],
          created_at: '2026-10-27T00:00:00Z',
        }),
      'GET /orgs/acme/settings': () =>
        json({
          timezone: 'UTC',
          locale: 'en-US',
          story_points_enabled: true,
          story_points_max: 21,
          updated_at: '2026-10-27T00:00:00Z',
        }),
      'GET /orgs/acme/projects/WEB/settings': () =>
        problem(409, 'project_settings_conflict', {
          errors: [{ field: 'story_points_max_override', message: 'conflicts' }],
        }),
      'GET /orgs/acme/issue-types': () => json({ items: [] }),
      'GET /orgs/acme/priorities': () => json({ items: [] }),
      'GET /orgs/acme/projects/WEB/members': () => json({ items: [] }),
      'GET /orgs/acme/projects/WEB/labels': () => json({ items: [] }),
      'GET /orgs/acme/issues/WEB-1/children': () => json({ items: [] }),
      'GET /orgs/acme/issues/WEB-1/activity': () => json({ items: [], next_cursor: null }),
      'GET /orgs/acme/issues/WEB-1/comments': () => json({ items: [] }),
    });
    renderApp('/o/acme/issues/WEB-1');
    expect(await screen.findByText(/conflict with organization settings/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Estimates' })).toHaveAttribute(
      'href',
      '/o/acme/p/WEB?tab=estimates',
    );
    expect(screen.getByText('5')).toBeInTheDocument();
  });
});
