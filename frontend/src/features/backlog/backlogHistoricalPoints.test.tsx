import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

import type { Issue } from '../../lib/api/types';

import { BacklogRow } from './BacklogRow';
import type { BacklogFields } from './backlogState';

const fields: BacklogFields = {
  type: true,
  key: true,
  epic: false,
  version: false,
  labels: false,
  points: true,
  priority: false,
  assignee: false,
  status: false,
};

function issue(storyPoints: number): Issue {
  return {
    id: 'i1',
    key: 'WEB-1',
    project_key: 'WEB',
    summary: 'Legacy estimate',
    description: null,
    type: { id: 't', name: 'Task', kind: 'standard' },
    status: { id: 's', name: 'To Do', category: 'todo' },
    priority: { id: 'p', name: 'Medium', color: '#888' },
    reporter: { id: 'u', display_name: 'Ann' },
    assignee: null,
    parent: null,
    labels: [],
    sprint: null,
    story_points: storyPoints,
    fix_version: null,
    version: 1,
    created_at: '2026-10-28T00:00:00Z',
    updated_at: '2026-10-28T00:00:00Z',
  };
}

describe('BacklogRow story points display', () => {
  it('renders historical values above current policy max unchanged', () => {
    render(
      <MemoryRouter>
        <BacklogRow
          issue={issue(50)}
          org="acme"
          canPlan={false}
          online
          selected={false}
          onSelect={() => undefined}
          targets={[]}
          onMove={() => undefined}
          fields={fields}
          density="default"
        />
      </MemoryRouter>,
    );
    expect(screen.getByLabelText('50 story points')).toHaveTextContent('50');
  });
});
