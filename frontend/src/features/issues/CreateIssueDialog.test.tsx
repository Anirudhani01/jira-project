import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../lib/api/errors';

import { CreateIssueDialog } from './CreateIssueDialog';

const createIssueState = vi.hoisted(() => ({
  error: null as ApiError | null,
  isPending: false,
  mutate: vi.fn(),
  reset: vi.fn(),
}));

vi.mock('./api', () => ({
  useCreateIssue: () => ({
    mutate: createIssueState.mutate,
    reset: createIssueState.reset,
    get isPending() {
      return createIssueState.isPending;
    },
    get error() {
      return createIssueState.error;
    },
  }),
  useIssueTypes: () => ({
    data: [{ id: 't1', name: 'Task', kind: 'standard' }],
  }),
  usePriorities: () => ({
    data: [{ id: 'p1', name: 'Medium' }],
  }),
  useLabels: () => ({ data: [] }),
  useIssue: () => undefined,
}));

vi.mock('../projects/api', () => ({
  useProjectMembers: () => ({ data: [] }),
}));

describe('CreateIssueDialog', () => {
  it('shows allowlisted copy on create 403', () => {
    createIssueState.error = new ApiError({
      status: 403,
      code: 'forbidden',
      title: 'Forbidden',
      detail: 'secret create denial',
    });
    render(
      <MemoryRouter>
        <CreateIssueDialog org="acme" project="WEB" onClose={() => undefined} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(/permission/i);
    expect(screen.getByRole('alert')).not.toHaveTextContent('secret create denial');
    createIssueState.error = null;
  });

  it('focuses summary after client validation failure', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <CreateIssueDialog org="acme" project="WEB" onClose={() => undefined} />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: 'Create' }));

    expect(await screen.findByText('Enter a summary.')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByLabelText('Summary')).toHaveFocus();
    });
  });
});
