import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { apiFetch, setCsrfToken } from '../../lib/api/client';
import { json, mockApi, problem, renderApp, SIGNED_IN } from '../../test/api';

import { SIGNUP_ACCEPTED_MESSAGE } from './pages/SignupPage';
import { safeNext } from './safeNext';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('safeNext', () => {
  it.each([
    ['/account', '/account'],
    ['/account?tab=1#x', '/account?tab=1#x'],
    [null, '/'],
    ['', '/'],
    ['https://evil.test/x', '/'],
    ['//evil.test/x', '/'],
    ['/\\evil.test', '/'],
    ['javascript:alert(1)', '/'],
    ['/\t/evil.test', '/'],
    ['/\n/evil.test', '/'],
    ['/%2F%2Fevil.test', '/%2F%2Fevil.test'],
  ])('%s -> %s', (input, expected) => {
    expect(safeNext(input)).toBe(expected);
  });
});

describe('CSRF header', () => {
  it('is sent on unsafe requests only, once known', async () => {
    const calls = mockApi({
      'GET /x': () => json({}),
      'POST /x': () => json({}),
    });
    setCsrfToken('tok');
    await apiFetch('/x');
    await apiFetch('/x', { method: 'POST', json: {} });
    expect(calls[0]?.headers.get('x-csrf-token')).toBeNull();
    expect(calls[1]?.headers.get('x-csrf-token')).toBe('tok');
    setCsrfToken(null);
  });
});

describe('RequireAuth', () => {
  it('redirects signed-out users to login with a next path', async () => {
    mockApi({ 'GET /auth/session': () => problem(401, 'unauthenticated') });
    const { router } = renderApp('/account?tab=sessions');
    await screen.findByRole('heading', { name: 'Sign in to your workspace' });
    expect(router.state.location.pathname).toBe('/login');
    expect(router.state.location.search).toBe(
      `?next=${encodeURIComponent('/account?tab=sessions')}`,
    );
  });

  it('includes hash in next when redirecting to login', async () => {
    mockApi({ 'GET /auth/session': () => problem(401, 'unauthenticated') });
    const { router } = renderApp('/account#sessions');
    await screen.findByRole('heading', { name: 'Sign in to your workspace' });
    expect(router.state.location.search).toBe(`?next=${encodeURIComponent('/account#sessions')}`);
  });

  it('uses safeNext for redirect targets (same helper as RequireAuth)', () => {
    expect(safeNext('//evil.test/phish')).toBe('/');
    expect(safeNext('/account?tab=sessions#pane')).toBe('/account?tab=sessions#pane');
  });
});

describe('LoginPage', () => {
  it('signs in and returns to the requested page', async () => {
    let signedIn = false;
    const calls = mockApi({
      'GET /auth/session': () => (signedIn ? json(SIGNED_IN) : problem(401, 'unauthenticated')),
      'POST /auth/login': () => {
        signedIn = true;
        return new Response(null, { status: 204 });
      },
      'GET /me/sessions': () => json({ items: [] }),
    });
    const { router } = renderApp('/login?next=%2Faccount');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Email'), 'ann@example.com');
    await user.type(screen.getByLabelText('Password'), 'Velvet-Harbor-Lantern-93');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/account');
    });
    const login = calls.find((c) => c.method === 'POST' && c.path === '/auth/login');
    expect(login?.body).toEqual({ email: 'ann@example.com', password: 'Velvet-Harbor-Lantern-93' }); // gitleaks:allow (synthetic test password)
  });

  it('shows a generic error for bad credentials', async () => {
    mockApi({
      'GET /auth/session': () => problem(401, 'unauthenticated'),
      'POST /auth/login': () => problem(401, 'invalid_credentials'),
    });
    renderApp('/login');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Email'), 'ann@example.com');
    await user.type(screen.getByLabelText('Password'), 'wrong-password-123');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Email or password is incorrect.');
  });

  it('explains rate limiting', async () => {
    mockApi({
      'GET /auth/session': () => problem(401, 'unauthenticated'),
      'POST /auth/login': () => problem(429, 'rate_limited'),
    });
    renderApp('/login');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Email'), 'ann@example.com');
    await user.type(screen.getByLabelText('Password'), 'wrong-password-123');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many attempts');
  });
});

describe('SignupPage', () => {
  it('shows the same neutral confirmation for every accepted signup', async () => {
    mockApi({
      'GET /auth/session': () => problem(401, 'unauthenticated'),
      'POST /auth/signup': () => json({ status: 'accepted' }, 202),
    });
    renderApp('/signup');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Name'), 'Ann');
    await user.type(screen.getByLabelText('Email'), 'ann@example.com');
    await user.type(screen.getByLabelText('Password'), 'Velvet-Harbor-Lantern-93');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByRole('status')).toHaveTextContent(SIGNUP_ACCEPTED_MESSAGE);
  });

  it('maps server password rejections onto the field', async () => {
    mockApi({
      'GET /auth/session': () => problem(401, 'unauthenticated'),
      'POST /auth/signup': () =>
        problem(422, 'password_rejected', {
          errors: [{ field: 'body.password', message: 'This password has appeared in a breach.' }],
        }),
    });
    renderApp('/signup');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Name'), 'Ann');
    await user.type(screen.getByLabelText('Email'), 'ann@example.com');
    await user.type(screen.getByLabelText('Password'), 'Password-123456');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('This password has appeared in a breach.')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toHaveAttribute('aria-invalid', 'true');
  });

  it('validates the minimum password length before calling the API', async () => {
    const calls = mockApi({ 'GET /auth/session': () => problem(401, 'unauthenticated') });
    renderApp('/signup');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Name'), 'Ann');
    await user.type(screen.getByLabelText('Email'), 'ann@example.com');
    await user.type(screen.getByLabelText('Password'), 'short');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('Use at least 12 characters.')).toBeInTheDocument();
    expect(calls.some((c) => c.path === '/auth/signup')).toBe(false);
  });
});
