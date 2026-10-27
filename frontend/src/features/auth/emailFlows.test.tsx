import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { json, mockApi, problem, renderApp, SIGNED_IN } from '../../test/api';

import { EMAIL_UNAVAILABLE_MESSAGE, RESET_REQUESTED_MESSAGE } from './pages/ForgotPasswordPage';
import { INVALID_RESET_LINK_MESSAGE } from './pages/ResetPasswordPage';
import { INVALID_LINK_MESSAGE } from './pages/VerifyEmailPage';

const TOKEN = 'tok_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_abcd';
const NEW_PASSWORD = 'Amber-Glacier-Orchid-71'; // gitleaks:allow (synthetic test password)

let referrerMeta: HTMLMetaElement;

beforeEach(() => {
  referrerMeta = document.createElement('meta');
  referrerMeta.name = 'referrer';
  referrerMeta.content = 'strict-origin-when-cross-origin';
  document.head.appendChild(referrerMeta);
});

afterEach(() => {
  referrerMeta.remove();
  vi.unstubAllGlobals();
});

const signedOut = () => problem(401, 'unauthenticated');

describe('VerifyEmailPage', () => {
  it('reads the token from the fragment, clears it and submits only on click', async () => {
    const calls = mockApi({
      'GET /auth/session': signedOut,
      'POST /auth/verify-email': () => new Response(null, { status: 204 }),
    });
    const { router, unmount } = renderApp(`/verify-email#token=${TOKEN}`);
    const button = await screen.findByRole('button', { name: 'Verify email address' });
    await waitFor(() => {
      expect(router.state.location.hash).toBe('');
    });
    expect(referrerMeta.content).toBe('no-referrer');
    expect(calls.some((c) => c.path === '/auth/verify-email')).toBe(false);

    await userEvent.setup().click(button);
    await screen.findByRole('heading', { name: 'Email verified' });
    const request = calls.find((c) => c.path === '/auth/verify-email');
    expect(request?.body).toEqual({ token: TOKEN });
    unmount();
    expect(referrerMeta.content).toBe('strict-origin-when-cross-origin');
  });

  it('sends the CSRF token when signed in', async () => {
    const calls = mockApi({
      'GET /auth/session': () => json(SIGNED_IN),
      'POST /auth/verify-email': () => new Response(null, { status: 204 }),
    });
    renderApp(`/verify-email#token=${TOKEN}`);
    const button = await screen.findByRole('button', { name: 'Verify email address' });
    await waitFor(() => {
      expect(button).toBeEnabled();
    });
    await userEvent.setup().click(button);
    await screen.findByRole('link', { name: 'Go to your account' });
    const request = calls.find((c) => c.path === '/auth/verify-email');
    expect(request?.headers.get('x-csrf-token')).toBe('csrf-abc');
  });

  it('explains an invalid or used link', async () => {
    mockApi({
      'GET /auth/session': signedOut,
      'POST /auth/verify-email': () => problem(400, 'invalid_token'),
    });
    renderApp(`/verify-email#token=${TOKEN}`);
    await userEvent
      .setup()
      .click(await screen.findByRole('button', { name: 'Verify email address' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(INVALID_LINK_MESSAGE);
  });

  it('shows the invalid-link message without a token and sends nothing', async () => {
    const calls = mockApi({ 'GET /auth/session': signedOut });
    renderApp('/verify-email');
    expect(await screen.findByRole('alert')).toHaveTextContent(INVALID_LINK_MESSAGE);
    expect(screen.queryByRole('button', { name: 'Verify email address' })).toBeNull();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });
});

describe('ForgotPasswordPage', () => {
  it('always shows the same confirmation', async () => {
    const calls = mockApi({
      'GET /auth/session': signedOut,
      'POST /auth/password-reset/request': () => json({ status: 'accepted' }, 202),
    });
    renderApp('/forgot-password');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Email'), 'ann@example.com');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByRole('status')).toHaveTextContent(RESET_REQUESTED_MESSAGE);
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ email: 'ann@example.com' });
  });

  it('is linked from the sign-in page', async () => {
    mockApi({ 'GET /auth/session': signedOut });
    renderApp('/login');
    expect(await screen.findByRole('link', { name: 'Forgot password?' })).toHaveAttribute(
      'href',
      '/forgot-password',
    );
  });
});

describe('ResetPasswordPage', () => {
  async function fillAndSubmit(password = NEW_PASSWORD, confirm = NEW_PASSWORD) {
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('New password'), password);
    await user.type(screen.getByLabelText('Confirm new password'), confirm);
    await user.click(screen.getByRole('button', { name: 'Change password' }));
  }

  it('submits the fragment token and tells the user they were signed out', async () => {
    const calls = mockApi({
      'GET /auth/session': signedOut,
      'POST /auth/password-reset/confirm': () => new Response(null, { status: 204 }),
    });
    const { router } = renderApp(`/reset-password#token=${TOKEN}`);
    await waitFor(() => {
      expect(router.state.location.hash).toBe('');
    });
    expect(referrerMeta.content).toBe('no-referrer');
    await fillAndSubmit();
    expect(await screen.findByRole('status')).toHaveTextContent(/signed out everywhere/);
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      token: TOKEN,
      new_password: NEW_PASSWORD,
    });
  });

  it('shows policy rejections on the password field', async () => {
    mockApi({
      'GET /auth/session': signedOut,
      'POST /auth/password-reset/confirm': () =>
        problem(422, 'password_rejected', {
          errors: [{ field: 'body.new_password', message: 'This password is too common.' }],
        }),
    });
    renderApp(`/reset-password#token=${TOKEN}`);
    await fillAndSubmit();
    expect(await screen.findByText('This password is too common.')).toBeInTheDocument();
  });

  it('checks that the passwords match before sending', async () => {
    const calls = mockApi({ 'GET /auth/session': signedOut });
    renderApp(`/reset-password#token=${TOKEN}`);
    await fillAndSubmit(NEW_PASSWORD, `${NEW_PASSWORD}x`);
    expect(await screen.findByText('Passwords do not match.')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('offers a new link when the token is rejected or missing', async () => {
    mockApi({
      'GET /auth/session': signedOut,
      'POST /auth/password-reset/confirm': () => problem(400, 'invalid_token'),
    });
    renderApp(`/reset-password#token=${TOKEN}`);
    await fillAndSubmit();
    expect(await screen.findByRole('alert')).toHaveTextContent(INVALID_RESET_LINK_MESSAGE);
    expect(screen.getByRole('link', { name: 'Request a new link' })).toHaveAttribute(
      'href',
      '/forgot-password',
    );
  });
});

describe('ForgotPasswordPage when email is unavailable', () => {
  it('does not claim a link was sent', async () => {
    mockApi({
      'GET /auth/session': signedOut,
      'POST /auth/password-reset/request': () => problem(503, 'email_unavailable'),
    });
    renderApp('/forgot-password');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Email'), 'ann@example.com');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(EMAIL_UNAVAILABLE_MESSAGE);
    expect(screen.queryByText(RESET_REQUESTED_MESSAGE)).toBeNull();
  });
});
