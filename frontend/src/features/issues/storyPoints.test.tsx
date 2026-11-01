import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { AppProviders } from '../../app/providers';
import { createQueryClient } from '../../lib/queryClient';
import type { Issue } from '../../lib/api/types';
import { json, mockApi, problem } from '../../test/api';

import { validPoints } from './CreateIssueDialog';
import { StoryPointsField } from './StoryPointsField';

const policyState = vi.hoisted(
  (): {
    status: 'ready' | 'conflict' | 'loading';
    effectiveEnabled: boolean;
    effectiveMax: number;
  } => ({
    status: 'ready',
    effectiveEnabled: true,
    effectiveMax: 100,
  }),
);

vi.mock('../storyPoints/useIssueStoryPointsPolicy', () => ({
  useIssueStoryPointsPolicy: () => ({
    status: policyState.status,
    effectiveEnabled: policyState.effectiveEnabled,
    effectiveMax: policyState.effectiveMax,
  }),
  isPolicyReady: (policy: { status: string }) => policy.status === 'ready',
}));

function issue(points: number | null): Issue {
  return {
    id: 'i1',
    key: 'WEB-1',
    project_key: 'WEB',
    summary: 'Estimated',
    description: null,
    type: { id: 't', name: 'Task', kind: 'standard' },
    status: { id: 's', name: 'To Do', category: 'todo' },
    priority: { id: 'p', name: 'Medium', color: '#888' },
    reporter: { id: 'u', display_name: 'Ann' },
    assignee: null,
    parent: null,
    labels: [],
    sprint: null,
    story_points: points,
    fix_version: null,
    version: 3,
    created_at: '2026-10-28T00:00:00Z',
    updated_at: '2026-10-28T00:00:00Z',
  };
}

function mount(points: number | null, canEdit = true) {
  return render(
    <AppProviders client={createQueryClient()}>
      <StoryPointsField org="acme" issue={issue(points)} canEdit={canEdit} />
    </AppProviders>,
  );
}

describe('validPoints', () => {
  it('accepts empty and whole numbers 0-100 only', () => {
    for (const ok of ['', ' ', '0', '5', '100', ' 42 ']) expect(validPoints(ok)).toBe(true);
    for (const bad of ['101', '-1', '2.5', 'abc', '1e2', '1000'])
      expect(validPoints(bad)).toBe(false);
  });
});

describe('StoryPointsField', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    policyState.status = 'ready';
    policyState.effectiveEnabled = true;
    policyState.effectiveMax = 100;
  });

  it('shows the estimate (or None) and is read-only without edit permission', () => {
    mount(5, false);
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('saves a new estimate with If-Match and the current version', async () => {
    const calls = mockApi({
      'PATCH /orgs/acme/issues/WEB-1': () => json(issue(8)),
    });
    mount(5);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Story points: 5/ }));
    const input = screen.getByRole('spinbutton', { name: 'Story points' });
    await user.clear(input);
    await user.type(input, '8');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(calls.some((c) => c.method === 'PATCH')).toBe(true);
    });
    const patch = calls.find((c) => c.method === 'PATCH');
    expect(patch?.body).toEqual({ story_points: 8 });
    expect(patch?.headers.get('If-Match')).toBe('"v3"');
  });

  it('clears the estimate by saving an empty value as null', async () => {
    const calls = mockApi({ 'PATCH /orgs/acme/issues/WEB-1': () => json(issue(null)) });
    mount(5);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Story points: 5/ }));
    await user.clear(screen.getByRole('spinbutton', { name: 'Story points' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ story_points: null });
    });
  });

  it('rejects invalid input locally and sends nothing', async () => {
    policyState.effectiveMax = 8;
    const calls = mockApi({});
    mount(null);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Story points: None/ }));
    await user.type(screen.getByRole('spinbutton', { name: 'Story points' }), '250');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('whole number from 0 to 8');
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(0);
  });

  it('shows historical estimate when disabled and allows clear', async () => {
    policyState.effectiveEnabled = false;
    const calls = mockApi({ 'PATCH /orgs/acme/issues/WEB-1': () => json(issue(null)) });
    mount(50);
    expect(screen.getByText('50')).toBeInTheDocument();
    expect(screen.getByText(/not enabled for this project/i)).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Story points: 50/ }));
    await user.clear(screen.getByRole('spinbutton', { name: 'Story points' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ story_points: null });
    });
  });

  it('blocks raising estimate when policy max is lower than historical value', async () => {
    policyState.effectiveMax = 8;
    mount(50);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Story points: 50/ }));
    await user.clear(screen.getByRole('spinbutton', { name: 'Story points' }));
    await user.type(screen.getByRole('spinbutton', { name: 'Story points' }), '51');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('0 to 8');
  });

  it('cancels with Escape without saving', async () => {
    const calls = mockApi({});
    mount(5);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Story points: 5/ }));
    await user.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: /Story points: 5/ })).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });

  it('reports a version conflict and leaves the estimate untouched', async () => {
    mockApi({ 'PATCH /orgs/acme/issues/WEB-1': () => problem(412, 'version_conflict') });
    mount(5);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Story points: 5/ }));
    const input = screen.getByRole('spinbutton', { name: 'Story points' });
    await user.clear(input);
    await user.type(input, '8');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Updated by someone else')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Story points: 5/ })).toBeInTheDocument();
  });
});
