import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { json, mockApi, problem, renderApp, SIGNED_IN } from '../../test/api';

afterEach(() => {
  vi.unstubAllGlobals();
});

const SESSIONS = {
  items: [
    {
      id: 's1',
      created_at: '2026-10-27T10:00:00Z',
      last_seen_at: '2026-10-27T10:00:00Z',
      expires_at: '2026-11-10T10:00:00Z',
      ip: '127.0.0.1',
      user_agent: 'Firefox',
      current: true,
    },
    {
      id: 's2',
      created_at: '2026-10-26T10:00:00Z',
      last_seen_at: '2026-10-26T10:00:00Z',
      expires_at: '2026-11-09T10:00:00Z',
      ip: '10.0.0.2',
      user_agent: 'Phone',
      current: false,
    },
  ],
};

describe('AccountPage', () => {
  it('lists sessions and revokes another session with the CSRF token', async () => {
    const calls = mockApi({
      'GET /auth/session': () => json(SIGNED_IN),
      'GET /me/sessions': () => json(SESSIONS),
      'DELETE /me/sessions/s2': () => new Response(null, { status: 204 }),
    });
    renderApp('/account');
    // The toast region is also a list, so pick the one holding the sessions.
    const current = await screen.findByText('(this device)');
    expect(within(current.closest('ul') as HTMLElement).getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText(/not verified yet/)).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Sign out session from Phone' }));
    await waitFor(() => {
      expect(calls.some((c) => c.method === 'DELETE' && c.path === '/me/sessions/s2')).toBe(true);
    });
    const revoke = calls.find((c) => c.method === 'DELETE');
    expect(revoke?.headers.get('x-csrf-token')).toBe(SIGNED_IN.csrf_token);
  });

  it('shows the current-password error from the server', async () => {
    mockApi({
      'GET /auth/session': () => json(SIGNED_IN),
      'GET /me/sessions': () => json(SESSIONS),
      'POST /me/password': () =>
        problem(422, 'invalid_current_password', {
          errors: [{ field: 'body.current_password', message: 'is incorrect' }],
        }),
    });
    renderApp('/account');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Current password'), 'wrong-password-1');
    await user.type(screen.getByLabelText('New password'), 'Copper-Meadow-Falcon-58');
    await user.type(screen.getByLabelText('Confirm new password'), 'Copper-Meadow-Falcon-58');
    await user.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByText('is incorrect')).toBeInTheDocument();
  });

  it('rejects mismatched password confirmation client-side', async () => {
    const calls = mockApi({
      'GET /auth/session': () => json(SIGNED_IN),
      'GET /me/sessions': () => json(SESSIONS),
    });
    renderApp('/account');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Current password'), 'current-password-1');
    await user.type(screen.getByLabelText('New password'), 'Copper-Meadow-Falcon-58');
    await user.type(screen.getByLabelText('Confirm new password'), 'Copper-Meadow-Falcon-59');
    await user.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByText('Passwords do not match.')).toBeInTheDocument();
    expect(calls.some((c) => c.path === '/me/password')).toBe(false);
  });

  it('signs out from the header and returns to login', async () => {
    let signedIn = true;
    const calls = mockApi({
      'GET /auth/session': () => (signedIn ? json(SIGNED_IN) : problem(401, 'unauthenticated')),
      'GET /me/sessions': () => json(SESSIONS),
      'POST /auth/logout': () => {
        signedIn = false;
        return new Response(null, { status: 204 });
      },
    });
    const { router } = renderApp('/account');
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('button', { name: new RegExp(SIGNED_IN.user.display_name, 'i') }),
    );
    await user.click(await screen.findByRole('menuitem', { name: 'Sign out' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/login');
    });
    const logout = calls.find((c) => c.path === '/auth/logout');
    expect(logout?.headers.get('x-csrf-token')).toBe(SIGNED_IN.csrf_token);
  });
});

describe('sign out failure', () => {
  it('keeps the user signed in and says so when the server rejects the logout', async () => {
    mockApi({
      'GET /auth/session': () => json(SIGNED_IN),
      'GET /me/sessions': () => json(SESSIONS),
      'POST /auth/logout': () => problem(403, 'csrf_failed'),
    });
    const { router } = renderApp('/account');
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('button', { name: new RegExp(SIGNED_IN.user.display_name, 'i') }),
    );
    await user.click(await screen.findByRole('menuitem', { name: 'Sign out' }));
    expect(await screen.findByText('Sign-out failed. Try again.')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/account');
    expect(
      screen.getByRole('button', { name: new RegExp(SIGNED_IN.user.display_name, 'i') }),
    ).toBeInTheDocument();
  });
});
