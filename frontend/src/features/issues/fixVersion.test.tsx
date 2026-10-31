import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { AppProviders } from '../../app/providers';
import type { Issue } from '../../lib/api/types';
import { createQueryClient } from '../../lib/queryClient';
import { json, mockApi, problem } from '../../test/api';

import { FixVersionField } from './FixVersionField';

function issue(fixVersion: Issue['fix_version']): Issue {
  return {
    id: 'i1',
    key: 'WEB-1',
    project_key: 'WEB',
    summary: 'Versioned',
    description: null,
    type: { id: 't', name: 'Task', kind: 'standard' },
    status: { id: 's', name: 'To Do', category: 'todo' },
    priority: { id: 'p', name: 'Medium', color: '#888' },
    reporter: { id: 'u', display_name: 'Ann' },
    assignee: null,
    parent: null,
    labels: [],
    sprint: null,
    story_points: null,
    fix_version: fixVersion,
    version: 4,
    created_at: '2026-10-28T00:00:00Z',
    updated_at: '2026-10-28T00:00:00Z',
  };
}

const VERSIONS = {
  items: [
    { id: 'v1', name: '1.0', status: 'unreleased' },
    { id: 'v2', name: '2.0', status: 'released' },
  ].map((v) => ({
    ...v,
    project_key: 'WEB',
    description: null,
    start_date: null,
    release_date: null,
    released_at: null,
    position: 0,
    overdue: false,
    issue_count: 0,
    todo_count: 0,
    in_progress_count: 0,
    done_count: 0,
  })),
};

function mount(current: Issue['fix_version'], canEdit = true) {
  return render(
    <AppProviders client={createQueryClient()}>
      <FixVersionField org="acme" issue={issue(current)} canEdit={canEdit} />
    </AppProviders>,
  );
}

describe('FixVersionField', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is read-only without edit permission', () => {
    mockApi({ 'GET /orgs/acme/projects/WEB/versions': () => json(VERSIONS) });
    mount({ id: 'v1', name: '1.0', status: 'unreleased' }, false);
    expect(screen.getByText('1.0')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('assigns a version with If-Match and clears it again', async () => {
    const calls = mockApi({
      'GET /orgs/acme/projects/WEB/versions': () => json(VERSIONS),
      'PATCH /orgs/acme/issues/WEB-1': () => json(issue(null)),
    });
    mount(null);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('combobox', { name: /Fix version/ }));
    await user.click(await screen.findByRole('option', { name: /2\.0/ }));
    await waitFor(() => {
      expect(calls.some((c) => c.method === 'PATCH')).toBe(true);
    });
    const patch = calls.find((c) => c.method === 'PATCH');
    expect(patch?.body).toEqual({ fix_version_id: 'v2' });
    expect(patch?.headers.get('If-Match')).toBe('"v4"');
  });

  it('keeps the shown version and says so when someone else changed the issue', async () => {
    mockApi({
      'GET /orgs/acme/projects/WEB/versions': () => json(VERSIONS),
      'PATCH /orgs/acme/issues/WEB-1': () => problem(412, 'version_conflict'),
    });
    mount({ id: 'v1', name: '1.0', status: 'unreleased' });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('combobox', { name: /Fix version/ }));
    await user.click(await screen.findByRole('option', { name: /2\.0/ }));
    expect(await screen.findByText('Updated by someone else')).toBeInTheDocument();
  });
});
