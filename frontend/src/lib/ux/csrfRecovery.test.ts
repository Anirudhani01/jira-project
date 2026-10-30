import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { sessionKey } from '../../features/auth/api';

import { refreshSessionCsrf, resetCsrfRefreshForTests } from './csrfRecovery';

afterEach(() => {
  resetCsrfRefreshForTests();
});

describe('refreshSessionCsrf', () => {
  it('reports failure when session refetch yields null', async () => {
    const client = new QueryClient();
    client.setQueryData(sessionKey, { user: { id: '1' }, csrf_token: 'x' });
    vi.spyOn(client, 'refetchQueries').mockResolvedValue(undefined);
    client.setQueryData(sessionKey, null);

    const result = await refreshSessionCsrf(client);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/sign in again/i);
    }
  });

  it('single-flights concurrent refresh calls', async () => {
    const client = new QueryClient();
    client.setQueryData(sessionKey, { user: { id: '1' }, csrf_token: 'tok' });
    const invalidate = vi.spyOn(client, 'invalidateQueries').mockResolvedValue(undefined);
    const refetch = vi.spyOn(client, 'refetchQueries').mockResolvedValue(undefined);

    await Promise.all([refreshSessionCsrf(client), refreshSessionCsrf(client)]);
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
