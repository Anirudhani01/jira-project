import type { Issue } from '../../lib/api/types';

import {
  defaultSprintDates,
  filterIssues,
  nextSelection,
  openCount,
  rangeKeys,
  statusCounts,
} from './backlogState';

function issue(key: string, category: string, extra: Partial<Issue> = {}): Issue {
  return {
    id: key,
    key,
    project_key: 'SCR',
    summary: `Summary ${key}`,
    description: null,
    type: { id: 't', name: 'Task', kind: 'standard' },
    status: { id: 's', name: category, category },
    priority: { id: 'p', name: 'Medium', color: '#888' },
    reporter: { id: 'u', display_name: 'Ann' },
    assignee: null,
    parent: null,
    labels: [],
    sprint: null,
    story_points: null,
    fix_version: null,
    version: 1,
    created_at: '2026-10-28T00:00:00Z',
    updated_at: '2026-10-28T00:00:00Z',
    ...extra,
  };
}

describe('statusCounts / openCount', () => {
  it('counts per status category and the issues a sprint completion would move', () => {
    const issues = [
      issue('A-1', 'todo'),
      issue('A-2', 'in_progress'),
      issue('A-3', 'done'),
      issue('A-4', 'todo'),
    ];
    expect(statusCounts(issues)).toEqual({ todo: 2, in_progress: 1, done: 1 });
    expect(openCount(issues)).toBe(3);
    expect(statusCounts([])).toEqual({ todo: 0, in_progress: 0, done: 0 });
  });
});

describe('filterIssues', () => {
  const issues = [
    issue('A-1', 'todo', {
      summary: 'Login button',
      assignee: { id: 'u1', display_name: 'Bob Stone' },
    }),
    issue('A-2', 'todo', {
      summary: 'Checkout',
      labels: [{ id: 'l', name: 'payments', color: '#fff' }],
    }),
    issue('A-3', 'todo', {
      summary: 'Child work',
      parent: { id: 'p', key: 'A-1', summary: 'Epic' },
    }),
  ];
  it('matches key, summary, assignee, label and parent, all words required', () => {
    expect(filterIssues(issues, 'login').map((i) => i.key)).toEqual(['A-1']);
    expect(filterIssues(issues, 'bob').map((i) => i.key)).toEqual(['A-1']);
    expect(filterIssues(issues, 'PAYMENTS').map((i) => i.key)).toEqual(['A-2']);
    expect(filterIssues(issues, 'a-1').map((i) => i.key)).toEqual(['A-1', 'A-3']);
    expect(filterIssues(issues, 'login bob').map((i) => i.key)).toEqual(['A-1']);
    expect(filterIssues(issues, 'login checkout')).toEqual([]);
    expect(filterIssues(issues, '  ')).toHaveLength(3);
  });
});

describe('selection', () => {
  const order = ['A', 'B', 'C', 'D', 'E'];
  it('computes inclusive ranges in either direction', () => {
    expect(rangeKeys(order, 'B', 'D')).toEqual(['B', 'C', 'D']);
    expect(rangeKeys(order, 'D', 'B')).toEqual(['B', 'C', 'D']);
    expect(rangeKeys(order, 'B', 'missing')).toEqual(['missing']);
  });
  it('toggles on a plain click and extends from the anchor on shift', () => {
    expect(nextSelection([], 'B', { shift: false, anchor: null, order })).toEqual(['B']);
    expect(nextSelection(['B'], 'B', { shift: false, anchor: 'B', order })).toEqual([]);
    expect(nextSelection(['A'], 'C', { shift: true, anchor: 'A', order })).toEqual(['A', 'B', 'C']);
    expect(nextSelection(['A'], 'C', { shift: true, anchor: null, order })).toEqual(['A', 'C']);
  });
});

describe('defaultSprintDates', () => {
  it('starts now and ends two weeks later in datetime-local format', () => {
    const { start, end } = defaultSprintDates(new Date(2026, 10, 2, 9, 30));
    expect(start).toBe('2026-11-02T09:30');
    expect(end).toBe('2026-11-16T09:30');
  });
});
