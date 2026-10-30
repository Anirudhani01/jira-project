import { describe, expect, it } from 'vitest';

import { ApiError } from '../api/errors';

import {
  isCsrfRecoveryError,
  isSessionUnauthenticatedError,
  shouldSkipSessionExpiryForQuery,
} from './sessionExpiry';

describe('sessionExpiry classification', () => {
  it('detects csrf_failed', () => {
    expect(
      isCsrfRecoveryError(new ApiError({ status: 403, code: 'csrf_failed', title: 'CSRF' })),
    ).toBe(true);
  });

  it('detects unauthenticated', () => {
    expect(
      isSessionUnauthenticatedError(
        new ApiError({ status: 401, code: 'unauthenticated', title: 'Auth' }),
      ),
    ).toBe(true);
  });

  it('skips session query key', () => {
    expect(shouldSkipSessionExpiryForQuery(['auth', 'session'])).toBe(true);
    expect(shouldSkipSessionExpiryForQuery(['issues', 'x'])).toBe(false);
  });
});
