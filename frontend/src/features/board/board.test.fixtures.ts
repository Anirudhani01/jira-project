import type { Board, Issue } from '../../lib/api/types';

export const TODO = 's-todo';
export const DOING = 's-doing';
export const DONE = 's-done';

export function card(
  key: string,
  statusId: string,
  version = 1,
  extra: Partial<Issue> = {},
): Issue {
  return {
    id: `id-${key}`,
    key,
    project_key: 'WEB',
    summary: `Summary ${key}`,
    description: null,
    type: { id: 't', name: 'Task', kind: 'standard' },
    status: { id: statusId, name: statusId, category: 'todo' },
    priority: { id: 'p', name: 'Medium', color: '#888888' },
    reporter: { id: 'u', display_name: 'Ann' },
    assignee: null,
    parent: null,
    labels: [],
    sprint: null,
    story_points: null,
    version,
    created_at: '2026-10-28T00:00:00Z',
    updated_at: '2026-10-28T00:00:00Z',
    ...extra,
  };
}

export function board(): Board {
  const column = (
    id: string,
    name: string,
    statusId: string,
    issues: Issue[],
    wip: number | null,
  ) => ({
    id,
    name,
    position: 0,
    wip_limit: wip,
    status_ids: [statusId],
    count: issues.length,
    over_wip_limit: wip !== null && issues.length > wip,
    issues,
  });
  return {
    project_key: 'WEB',
    board_type: 'kanban',
    truncated: false,
    sprint: null,
    columns: [
      column('c1', 'To Do', TODO, [card('WEB-1', TODO), card('WEB-2', TODO)], 1),
      column('c2', 'Doing', DOING, [card('WEB-3', DOING)], null),
      column('c3', 'Done', DONE, [], null),
    ],
    transitions: [
      { from_status_id: TODO, to_status_id: DOING },
      { from_status_id: DOING, to_status_id: DONE },
    ],
  };
}
