import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { Issue } from '../../lib/api/types';

import { IssueListAssigneeMenu } from './IssueListRowMenus';

vi.mock('./api', () => ({
  useUpdateIssue: () => ({ mutate: vi.fn(), isPending: false }),
  useApplyTransition: () => ({ mutate: vi.fn(), isPending: false }),
  useTransitions: () => ({ data: [], isPending: false }),
}));

const ISSUE = {
  id: '55555555-5555-5555-5555-555555555555',
  key: 'WEB-1',
  project_key: 'WEB',
  summary: 'Example',
  assignee: { id: 'u1', display_name: 'Ann Example' },
  version: 1,
} as unknown as Issue;

describe('person menu button', () => {
  it('keeps the visible name inside its accessible name and shows the name only once', () => {
    render(<IssueListAssigneeMenu org="acme" issue={ISSUE} members={[]} canAssign />);
    const button = screen.getByRole('button', { name: /^Assignee: Ann Example/ });
    // Label in name: the visible text must be part of the accessible name.
    expect(button).toHaveAccessibleName(expect.stringContaining('Ann Example'));
    // The avatar is decorative here, so the name is not repeated as hidden text.
    expect(within(button).getAllByText('Ann Example')).toHaveLength(1);
  });
});
