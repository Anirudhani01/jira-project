import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  configureSessionExpiryController,
  confirmSessionExpiryContinue,
  confirmSessionExpiryWithoutRecovery,
  getSessionExpiryPhase,
  isSessionExpiryBlocking,
  notifyNavigationSettled,
  onSessionUnauthenticatedError,
  resetSessionExpiryControllerForTests,
  retrySessionExpiryPersist,
  type SessionExpiryDialogModel,
} from './sessionExpiryController';
import { registerIssueDetailDraftSnapshot } from './issueDetailDraft';

afterEach(() => {
  resetSessionExpiryControllerForTests();
  registerIssueDetailDraftSnapshot(null);
  sessionStorage.clear();
});

function setupEnv(overrides: Partial<Parameters<typeof configureSessionExpiryController>[0]> = {}) {
  const navigateToLogin = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  const clearSessionState = vi.fn();
  configureSessionExpiryController({
    getHadEstablishedSession: () => true,
    getLogoutIntent: () => false,
    isAuthRoute: () => false,
    isLoginRoute: () => false,
    onPhaseChange: () => undefined,
    onDialogChange: () => undefined,
    clearSessionState,
    navigateToLogin,
    ...overrides,
  });
  return { navigateToLogin, clearSessionState };
}

describe('sessionExpiryController', () => {
  it('single-flight concurrent expiry requests', async () => {
    const onDialogChange = vi.fn<(model: SessionExpiryDialogModel | null) => void>();
    setupEnv({ onDialogChange });
    onSessionUnauthenticatedError('/a');
    onSessionUnauthenticatedError('/b');
    await Promise.resolve();
    expect(onDialogChange).toHaveBeenCalledTimes(1);
    expect(isSessionExpiryBlocking()).toBe(true);
  });

  it('does not start when logout intent is set', () => {
    const onDialogChange = vi.fn<(model: SessionExpiryDialogModel | null) => void>();
    setupEnv({ getLogoutIntent: () => true, onDialogChange });
    onSessionUnauthenticatedError('/account');
    expect(onDialogChange).not.toHaveBeenCalled();
  });

  it('persists draft only after confirm', async () => {
    registerIssueDetailDraftSnapshot(() => ({
      org: 'acme',
      issueKey: 'P-1',
      field: 'summary',
      value: 'Edited',
      baseVersion: 3,
    }));
    const { navigateToLogin, clearSessionState } = setupEnv();
    onSessionUnauthenticatedError('/o/acme/issues/P-1');
    await Promise.resolve();
    expect(sessionStorage.length).toBe(0);
    confirmSessionExpiryContinue();
    expect(sessionStorage.getItem('ux:issue-field-drafts:v1')).toContain('Edited');
    expect(clearSessionState).toHaveBeenCalled();
    expect(navigateToLogin).toHaveBeenCalled();
    expect(getSessionExpiryPhase()).toBe('navigating');
  });

  it('retains memory snapshot when persist fails', async () => {
    const persist = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    registerIssueDetailDraftSnapshot(() => ({
      org: 'acme',
      issueKey: 'P-1',
      field: 'summary',
      value: 'Edited',
      baseVersion: 3,
    }));
    const onDialogChange = vi.fn<(model: SessionExpiryDialogModel | null) => void>();
    const { navigateToLogin } = setupEnv({ onDialogChange });
    onSessionUnauthenticatedError('/x');
    await Promise.resolve();
    confirmSessionExpiryContinue();
    expect(navigateToLogin).not.toHaveBeenCalled();
    const lastCall = onDialogChange.mock.calls.at(-1)?.[0];
    expect(lastCall?.persistError).toBeTruthy();
    persist.mockRestore();
    retrySessionExpiryPersist();
    expect(navigateToLogin).toHaveBeenCalled();
  });

  it('continue without recovery skips persist', () => {
    registerIssueDetailDraftSnapshot(() => ({
      org: 'acme',
      issueKey: 'P-1',
      field: 'summary',
      value: 'Edited',
      baseVersion: 3,
    }));
    const { navigateToLogin } = setupEnv();
    onSessionUnauthenticatedError('/x');
    confirmSessionExpiryWithoutRecovery();
    expect(sessionStorage.length).toBe(0);
    expect(navigateToLogin).toHaveBeenCalled();
  });

  it('completes navigation lifecycle on settle', async () => {
    registerIssueDetailDraftSnapshot(() => ({
      org: 'acme',
      issueKey: 'P-1',
      field: 'summary',
      value: 'Edited',
      baseVersion: 3,
    }));
    const onDialogChange = vi.fn<(model: SessionExpiryDialogModel | null) => void>();
    setupEnv({ onDialogChange });
    onSessionUnauthenticatedError('/x');
    await Promise.resolve();
    confirmSessionExpiryContinue();
    notifyNavigationSettled();
    expect(getSessionExpiryPhase()).toBe('idle');
    expect(onDialogChange).toHaveBeenLastCalledWith(null);
  });

  it('returns to dialog when navigation fails and preserves draft', async () => {
    registerIssueDetailDraftSnapshot(() => ({
      org: 'acme',
      issueKey: 'P-1',
      field: 'summary',
      value: 'Edited',
      baseVersion: 3,
    }));
    const onDialogChange = vi.fn<(model: SessionExpiryDialogModel | null) => void>();
    const navigateToLogin = vi.fn<() => Promise<void>>().mockRejectedValue(new Error('Blocked'));
    setupEnv({ onDialogChange, navigateToLogin });
    onSessionUnauthenticatedError('/x');
    await Promise.resolve();
    confirmSessionExpiryContinue();
    await vi.waitFor(() => {
      expect(getSessionExpiryPhase()).toBe('awaiting_user');
    });
    const last = onDialogChange.mock.calls.at(-1)?.[0];
    expect(last?.navigationError).toMatch(/blocked/i);
    expect(last?.recoverableDraft?.value).toBe('Edited');
  });

  it('ignores duplicate confirm while navigating', async () => {
    const navigateToLogin = vi
      .fn<() => Promise<void>>()
      .mockReturnValue(new Promise(() => undefined));
    setupEnv({ navigateToLogin });
    onSessionUnauthenticatedError('/x');
    await Promise.resolve();
    confirmSessionExpiryContinue();
    confirmSessionExpiryContinue();
    expect(navigateToLogin).toHaveBeenCalledTimes(1);
  });

  it('can retry navigation after failure', async () => {
    const navigateToLogin = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce(undefined);
    const onDialogChange = vi.fn<(model: SessionExpiryDialogModel | null) => void>();
    setupEnv({ navigateToLogin, onDialogChange });
    onSessionUnauthenticatedError('/x');
    await Promise.resolve();
    confirmSessionExpiryContinue();
    await vi.waitFor(() => {
      expect(getSessionExpiryPhase()).toBe('awaiting_user');
    });
    confirmSessionExpiryContinue();
    expect(navigateToLogin).toHaveBeenCalledTimes(2);
  });

  it('returns to awaiting_user when navigation resolves but login route is not reached', async () => {
    const onDialogChange = vi.fn<(model: SessionExpiryDialogModel | null) => void>();
    const navigateToLogin = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    setupEnv({
      onDialogChange,
      navigateToLogin,
      isLoginRoute: () => false,
      isAuthRoute: () => false,
    });
    onSessionUnauthenticatedError('/o/acme/issues/P-1');
    await Promise.resolve();
    confirmSessionExpiryContinue();
    await new Promise<void>((resolve) => {
      queueMicrotask(() => {
        resolve();
      });
    });
    expect(getSessionExpiryPhase()).toBe('awaiting_user');
    const last = onDialogChange.mock.calls.at(-1)?.[0];
    expect(last?.navigationError).toMatch(/sign-in page did not open/i);
  });

  it('does not rewrite sessionStorage when retrying navigation after draft was persisted', async () => {
    registerIssueDetailDraftSnapshot(() => ({
      org: 'acme',
      issueKey: 'P-1',
      field: 'summary',
      value: 'Edited',
      baseVersion: 3,
    }));
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const navigateToLogin = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce(undefined);
    setupEnv({ navigateToLogin, isLoginRoute: () => false });
    onSessionUnauthenticatedError('/x');
    await Promise.resolve();
    confirmSessionExpiryContinue();
    await Promise.resolve();
    const writesAfterFirstConfirm = setItem.mock.calls.length;
    expect(writesAfterFirstConfirm).toBeGreaterThan(0);
    confirmSessionExpiryContinue();
    await Promise.resolve();
    expect(setItem.mock.calls.length).toBe(writesAfterFirstConfirm);
    setItem.mockRestore();
  });
});
