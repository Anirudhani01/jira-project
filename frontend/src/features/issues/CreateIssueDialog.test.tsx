import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { CreateIssueDialog } from './CreateIssueDialog';

vi.mock('./api', () => ({
  useCreateIssue: () => ({
    mutate: vi.fn(),
    reset: vi.fn(),
    isPending: false,
    error: null,
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
