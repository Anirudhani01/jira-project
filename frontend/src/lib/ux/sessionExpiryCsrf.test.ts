import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { sessionKey } from '../../features/auth/api';

import { refreshSessionCsrf, resetCsrfRefreshForTests } from './csrfRecovery';
import {
  configureSessionExpiryController,
  onSessionUnauthenticatedError,
  resetSessionExpiryControllerForTests,
  type SessionExpiryDialogModel,
} from './sessionExpiryController';

afterEach(() => {
  resetCsrfRefreshForTests();
  resetSessionExpiryControllerForTests();
});

describe('session expiry vs CSRF refresh', () => {
  it('queues 401 during CSRF refresh and opens dialog after failed refresh', async () => {
    const onDialogChange = vi.fn<(model: SessionExpiryDialogModel | null) => void>();
    configureSessionExpiryController({
      getHadEstablishedSession: () => true,
      getLogoutIntent: () => false,
      isAuthRoute: () => false,
      isLoginRoute: () => false,
      onPhaseChange: () => undefined,
      onDialogChange,
      clearSessionState: vi.fn(),
      navigateToLogin: vi.fn().mockResolvedValue(undefined),
    });

    const client = new QueryClient();
    client.setQueryData(sessionKey, { user: { id: '1' }, csrf_token: 'x' });

    let finishRefetch: () => void = () => undefined;
    const refetchGate = new Promise<void>((resolve) => {
      finishRefetch = resolve;
    });
    vi.spyOn(client, 'invalidateQueries').mockResolvedValue(undefined);
    vi.spyOn(client, 'refetchQueries').mockImplementation(async () => {
      await refetchGate;
    });

    const refreshPromise = refreshSessionCsrf(client);
    onSessionUnauthenticatedError('/o/acme/issues/WEB-1');
    await Promise.resolve();
    expect(onDialogChange).not.toHaveBeenCalled();

    client.setQueryData(sessionKey, null);
    finishRefetch();
    await refreshPromise;
    await Promise.resolve();

    expect(onDialogChange).toHaveBeenCalledTimes(1);
    expect(onDialogChange.mock.calls[0]?.[0]?.nextPath).toBe('/o/acme/issues/WEB-1');
  });

  it('queues 401 during CSRF refresh and opens dialog after successful refresh', async () => {
    const onDialogChange = vi.fn<(model: SessionExpiryDialogModel | null) => void>();
    configureSessionExpiryController({
      getHadEstablishedSession: () => true,
      getLogoutIntent: () => false,
      isAuthRoute: () => false,
      isLoginRoute: () => false,
      onPhaseChange: () => undefined,
      onDialogChange,
      clearSessionState: vi.fn(),
      navigateToLogin: vi.fn().mockResolvedValue(undefined),
    });

    const client = new QueryClient();
    client.setQueryData(sessionKey, { user: { id: '1' }, csrf_token: 'x' });
    vi.spyOn(client, 'invalidateQueries').mockResolvedValue(undefined);
    vi.spyOn(client, 'refetchQueries').mockResolvedValue(undefined);

    const refreshPromise = refreshSessionCsrf(client);
    onSessionUnauthenticatedError('/account');
    await refreshPromise;
    await Promise.resolve();

    expect(onDialogChange).toHaveBeenCalledTimes(1);
  });

  it('does not open duplicate dialogs when expiry already active after CSRF', async () => {
    const onDialogChange = vi.fn<(model: SessionExpiryDialogModel | null) => void>();
    configureSessionExpiryController({
      getHadEstablishedSession: () => true,
      getLogoutIntent: () => false,
      isAuthRoute: () => false,
      isLoginRoute: () => false,
      onPhaseChange: () => undefined,
      onDialogChange,
      clearSessionState: vi.fn(),
      navigateToLogin: vi.fn().mockResolvedValue(undefined),
    });

    const client = new QueryClient();
    client.setQueryData(sessionKey, null);
    vi.spyOn(client, 'invalidateQueries').mockResolvedValue(undefined);
    vi.spyOn(client, 'refetchQueries').mockResolvedValue(undefined);

    onSessionUnauthenticatedError('/first');
    await Promise.resolve();
    expect(onDialogChange).toHaveBeenCalledTimes(1);

    const refreshPromise = refreshSessionCsrf(client);
    onSessionUnauthenticatedError('/second');
    await refreshPromise;
    await Promise.resolve();

    expect(onDialogChange).toHaveBeenCalledTimes(1);
  });
});
