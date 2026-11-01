import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { ToastProvider } from '../../components/ui/Toast';
import { ApiError } from '../../lib/api/errors';

import { CreateIssueDialog } from './CreateIssueDialog';

const onlineState = vi.hoisted(() => ({ online: true }));

vi.mock('../../app/OnlineStatusProvider', () => ({
  useAppOnline: () => onlineState.online,
}));

const searchState = vi.hoisted(() => ({
  hits: [] as { id: string; key: string; summary: string; type: { name: string; kind: string } }[],
}));

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
    data: [
      { id: 't1', name: 'Task', kind: 'standard', is_active: true },
      { id: 't2', name: 'Sub-task', kind: 'subtask', is_active: true },
    ],
  }),
  usePriorities: () => ({
    data: [{ id: 'p1', name: 'Medium', is_active: true }],
  }),
  useLabels: () => ({ data: [] }),
  useIssueSearch: () => ({ data: searchState.hits, isFetching: false }),
}));

vi.mock('../backlog/planApi', () => ({
  useVersions: () => ({ data: [] }),
}));

vi.mock('../projects/api', () => ({
  useProjectMembers: () => ({ data: [] }),
}));

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
        <ToastProvider>
          <CreateIssueDialog org="acme" project="WEB" onClose={() => undefined} />
        </ToastProvider>
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
        <ToastProvider>
          <CreateIssueDialog org="acme" project="WEB" onClose={() => undefined} />
        </ToastProvider>
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: 'Create' }));

    expect(await screen.findByText('Enter a summary.')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByLabelText('Summary')).toHaveFocus();
    });
  });

  function mountDialog() {
    return render(
      <MemoryRouter>
        <ToastProvider>
          <CreateIssueDialog org="acme" project="WEB" onClose={() => undefined} />
        </ToastProvider>
      </MemoryRouter>,
    );
  }

  it('disables creation while offline, explains why and keeps what was typed', async () => {
    onlineState.online = false;
    try {
      mountDialog();
      const user = userEvent.setup();
      await user.type(screen.getByLabelText('Summary'), 'Kept while offline');
      expect(screen.getByText(/You are offline/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled();
      expect(screen.getByLabelText('Summary')).toHaveValue('Kept while offline');
    } finally {
      onlineState.online = true;
    }
  });

  it('requires a parent for a sub-task, searches parents and sends parent_id', async () => {
    createIssueState.mutate.mockClear();
    searchState.hits = [
      {
        id: 'story-1',
        key: 'WEB-3',
        summary: 'Checkout flow',
        type: { name: 'Task', kind: 'standard' },
      },
    ];
    mountDialog();
    const user = userEvent.setup();
    await user.click(screen.getByRole('combobox', { name: /^Type/ }));
    await user.click(await screen.findByRole('option', { name: /Sub-task/ }));
    await user.type(screen.getByLabelText('Summary'), 'Write tests');
    await user.click(screen.getByRole('button', { name: 'Create' }));
    expect(await screen.findByText('Choose a parent issue for a sub-task.')).toBeInTheDocument();
    expect(createIssueState.mutate).not.toHaveBeenCalled();

    await user.click(screen.getByRole('combobox', { name: /^Parent/ }));
    await user.click(await screen.findByRole('option', { name: /WEB-3/ }));
    await user.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => {
      expect(createIssueState.mutate).toHaveBeenCalledTimes(1);
    });
    const [request] = createIssueState.mutate.mock.calls[0] as [{ body: Record<string, unknown> }];
    expect(request.body).toMatchObject({
      type_id: 't2',
      parent_id: 'story-1',
      summary: 'Write tests',
    });
    searchState.hits = [];
  });

  it('"Create another" keeps the dialog open, clears the text, keeps the type and uses a fresh key', async () => {
    createIssueState.mutate.mockReset();
    createIssueState.mutate.mockImplementation(
      (
        _request: unknown,
        options?: { onSuccess?: (issue: { key: string; summary: string }) => void },
      ) => {
        options?.onSuccess?.({ key: 'WEB-9', summary: 'First' });
      },
    );
    mountDialog();
    const user = userEvent.setup();
    await user.click(screen.getByRole('checkbox', { name: 'Create another' }));
    await user.type(screen.getByLabelText('Summary'), 'First');
    await user.click(screen.getByRole('button', { name: 'Create' }));
    expect(await screen.findByText('WEB-9 created')).toBeInTheDocument();
    expect(screen.getByLabelText('Summary')).toHaveValue('');
    expect(screen.getByRole('dialog', { name: 'Create issue' })).toBeInTheDocument();

    await user.type(screen.getByLabelText('Summary'), 'Second');
    await user.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => {
      expect(createIssueState.mutate).toHaveBeenCalledTimes(2);
    });
    const keys = createIssueState.mutate.mock.calls.map(
      ([request]) => (request as { idempotencyKey: string }).idempotencyKey,
    );
    expect(keys[0]).not.toBe(keys[1]);
    createIssueState.mutate.mockReset();
  });

  it('closes itself after creating one issue, since the shell may own the dialog', async () => {
    createIssueState.mutate.mockReset();
    createIssueState.mutate.mockImplementation(
      (
        _request: unknown,
        options?: { onSuccess?: (issue: { key: string; summary: string }) => void },
      ) => {
        options?.onSuccess?.({ key: 'WEB-5', summary: 'One' });
      },
    );
    const onClose = vi.fn();
    render(
      <MemoryRouter>
        <ToastProvider>
          <CreateIssueDialog org="acme" project="WEB" onClose={onClose} />
        </ToastProvider>
      </MemoryRouter>,
    );
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Summary'), 'One');
    await user.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
    createIssueState.mutate.mockReset();
  });

  it('hides story points when policy disables estimates', () => {
    policyState.effectiveEnabled = false;
    try {
      mountDialog();
      expect(screen.queryByLabelText(/Story points/i)).toBeNull();
    } finally {
      policyState.effectiveEnabled = true;
    }
  });

  it('shows conflict banner and hides story points field', () => {
    policyState.status = 'conflict';
    try {
      mountDialog();
      expect(screen.getByText(/conflict with organization settings/i)).toBeInTheDocument();
      expect(screen.queryByLabelText(/Story points/i)).toBeNull();
    } finally {
      policyState.status = 'ready';
    }
  });

  it('validates against effective max before create', async () => {
    policyState.effectiveMax = 8;
    try {
      mountDialog();
      const user = userEvent.setup();
      await user.type(screen.getByLabelText('Summary'), 'Sized');
      await user.type(screen.getByLabelText(/Story points/i), '9');
      await user.click(screen.getByRole('button', { name: 'Create' }));
      expect(await screen.findByText(/0 to 8/)).toBeInTheDocument();
      expect(createIssueState.mutate).not.toHaveBeenCalled();
    } finally {
      policyState.effectiveMax = 100;
    }
  });
});
