import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { AppProviders } from '../providers';
import { createQueryClient } from '../../lib/queryClient';
import { json, mockApi } from '../../test/api';

import { AssignDialog } from './AssignDialog';

const MEMBERS = {
  items: [
    { user_id: 'u1', display_name: 'Ann Example', email: 'ann@example.com', role: 'member' },
    { user_id: 'u2', display_name: 'Bob Stone', email: 'bob@example.com', role: 'member' },
  ],
};
const ok = (keys: string[]) =>
  json({
    results: keys.map((key) => ({ key, ok: true, code: null, message: null })),
    succeeded: keys.length,
    failed: 0,
  });

function mount(onResult = vi.fn(), onClose = vi.fn()) {
  render(
    <AppProviders client={createQueryClient()}>
      <AssignDialog org="acme" issueKey="WEB-7" onClose={onClose} onResult={onResult} />
    </AppProviders>,
  );
  return { onResult, onClose };
}

describe('AssignDialog', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('assigns the chosen member through the bulk endpoint and closes', async () => {
    const calls = mockApi({
      'GET /orgs/acme/projects/WEB/members': () => json(MEMBERS),
      'POST /orgs/acme/issues/bulk': () => ok(['WEB-7']),
    });
    const { onResult, onClose } = mount();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('combobox', { name: /^Assignee/ }));
    await user.click(await screen.findByRole('option', { name: /Bob Stone/ }));
    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      keys: ['WEB-7'],
      action: 'assign',
      assignee_id: 'u2',
    });
    expect(onResult).toHaveBeenCalledWith({ title: 'WEB-7 assigned' });
  });

  it('can unassign, and reports a refusal without closing', async () => {
    mockApi({
      'GET /orgs/acme/projects/WEB/members': () => json(MEMBERS),
      'POST /orgs/acme/issues/bulk': () =>
        json({
          results: [{ key: 'WEB-7', ok: false, code: 'forbidden', message: 'No permission.' }],
          succeeded: 0,
          failed: 1,
        }),
    });
    const { onResult, onClose } = mount();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('combobox', { name: /^Assignee/ }));
    await user.click(await screen.findByRole('option', { name: 'Unassigned' }));
    await waitFor(() => {
      expect(onResult).toHaveBeenCalled();
    });
    expect(onResult).toHaveBeenCalledWith({
      title: 'Could not assign WEB-7',
      description: 'No permission.',
      error: true,
    });
    expect(onClose).not.toHaveBeenCalled();
  });
});
