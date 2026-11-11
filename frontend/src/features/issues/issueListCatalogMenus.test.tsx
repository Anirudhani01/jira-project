import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { Issue, IssueType, Priority } from '../../lib/api/types';

import { selectableCatalogEntries } from './catalogUtils';
import { IssueListPriorityMenu, IssueListTypeMenu } from './IssueListRowMenus';

vi.mock('./api', () => ({
  useUpdateIssue: () => ({ mutate: vi.fn(), isPending: false }),
}));

const BASE_ISSUE: Issue = {
  id: '55555555-5555-5555-5555-555555555555',
  key: 'WEB-1',
  project_key: 'WEB',
  summary: 'Example',
  description: null,
  type: { id: 't-legacy', name: 'Legacy', kind: 'standard' },
  status: { id: 's1', name: 'To Do', category: 'todo' },
  priority: { id: 'p-legacy', name: 'Old priority', color: '#111111' },
  reporter: { id: 'u1', display_name: 'Ann' },
  assignee: null,
  parent: null,
  labels: [],
  fix_version: null,
  sprint: null,
  story_points: null,
  version: 1,
  created_at: '2026-10-28T00:00:00Z',
  updated_at: '2026-10-28T00:00:00Z',
};

const TYPES: IssueType[] = [
  { id: 't-task', name: 'Task', kind: 'standard', position: 0, is_active: true },
  { id: 't-legacy', name: 'Legacy', kind: 'standard', position: 1, is_active: false },
  { id: 't-wonfix', name: 'WonFix', kind: 'standard', position: 2, is_active: false },
];

const PRIORITIES: Priority[] = [
  { id: 'p-high', name: 'High', sort_order: 0, color: '#ff0000', is_active: true },
  { id: 'p-legacy', name: 'Old priority', sort_order: 1, color: '#111111', is_active: false },
  { id: 'p-low', name: 'Low', sort_order: 2, color: '#0000ff', is_active: false },
];

describe('issue list catalog menus', () => {
  it('type menu hides inactive types except the issue’s current type', async () => {
    const user = userEvent.setup();
    render(
      <IssueListTypeMenu
        org="acme"
        issue={BASE_ISSUE}
        types={selectableCatalogEntries(TYPES, BASE_ISSUE.type.id)}
        canEdit
      />,
    );
    await user.click(screen.getByRole('button', { name: /Type: Legacy/ }));
    const menu = await screen.findByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: /Task/ })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: /Legacy/ })).toBeInTheDocument();
    expect(within(menu).queryByRole('menuitem', { name: /WonFix/ })).not.toBeInTheDocument();
  });

  it('priority menu hides inactive priorities except the issue’s current priority', async () => {
    const user = userEvent.setup();
    render(
      <IssueListPriorityMenu
        org="acme"
        issue={BASE_ISSUE}
        priorities={selectableCatalogEntries(PRIORITIES, BASE_ISSUE.priority.id)}
        canEdit
      />,
    );
    await user.click(screen.getByRole('button', { name: /Priority: Old priority/ }));
    const menu = await screen.findByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: /High/ })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: /Old priority/ })).toBeInTheDocument();
    expect(within(menu).queryByRole('menuitem', { name: /^Low$/ })).not.toBeInTheDocument();
  });
});
