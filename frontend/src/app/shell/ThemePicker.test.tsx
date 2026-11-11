import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { json, mockApi, renderApp, SIGNED_IN } from '../../test/api';

const SESSION = {
  ...SIGNED_IN,
  user: { ...SIGNED_IN.user, email_verified: true },
  orgs: [{ slug: 'acme', name: 'Acme', role: 'member' }],
};

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.removeItem('theme');
  delete document.documentElement.dataset.theme;
});

describe('theme picker in the account menu', () => {
  async function openMenu() {
    mockApi({ 'GET /auth/session': () => json(SESSION) });
    renderApp('/account');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Open account menu/ }));
    return user;
  }

  it('lists every theme and marks the current one', async () => {
    await openMenu();
    expect(await screen.findByRole('menuitemradio', { name: 'Light' })).toBeChecked();
    for (const name of ['Dark', 'Paper', 'System']) {
      expect(screen.getByRole('menuitemradio', { name })).not.toBeChecked();
    }
  });

  it('applies and remembers the paper theme without closing the menu', async () => {
    const user = await openMenu();
    await user.click(await screen.findByRole('menuitemradio', { name: 'Paper' }));
    await waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe('paper');
    });
    expect(localStorage.getItem('theme')).toBe('paper');
    // The menu stays open so themes can be compared; the choice is now the checked one.
    expect(screen.getByRole('menuitemradio', { name: 'Paper' })).toBeChecked();
    expect(screen.getByRole('menuitemradio', { name: 'Light' })).not.toBeChecked();
  });

  it('switches back to dark and persists it', async () => {
    const user = await openMenu();
    await user.click(await screen.findByRole('menuitemradio', { name: 'Dark' }));
    await waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe('dark');
    });
    expect(localStorage.getItem('theme')).toBe('dark');
  });
});
