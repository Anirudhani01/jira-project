import { describe, expect, it } from 'vitest';

import { ApiError, networkError } from '../api/errors';

import { mapApiErrorToUxState } from './mapApiErrorToUxState';

function api(init: ConstructorParameters<typeof ApiError>[0]) {
  return new ApiError(init);
}

describe('mapApiErrorToUxState', () => {
  it('returns generic for non-ApiError', () => {
    expect(mapApiErrorToUxState(new Error('nope')).kind).toBe('generic');
  });

  it('classifies network errors', () => {
    const mapped = mapApiErrorToUxState(networkError(new TypeError('fetch')));
    expect(mapped.kind).toBe('network');
    expect(mapped.retryable).toBe(true);
  });

  it('401 invalid_credentials is login form error', () => {
    const mapped = mapApiErrorToUxState(
      api({ status: 401, code: 'invalid_credentials', title: 'Unauthorized' }),
    );
    expect(mapped.kind).toBe('auth_credentials');
    expect(mapped.retryable).toBe(false);
  });

  it('401 on login surface is auth_credentials even without code', () => {
    const mapped = mapApiErrorToUxState(
      api({ status: 401, code: 'unauthenticated', title: 'Unauthorized' }),
      { surface: 'login' },
    );
    expect(mapped.kind).toBe('auth_credentials');
  });

  it('401 unauthenticated with established session is session expiry', () => {
    const mapped = mapApiErrorToUxState(
      api({ status: 401, code: 'unauthenticated', title: 'Authentication required' }),
      { hadEstablishedSession: true },
    );
    expect(mapped.kind).toBe('session_unauthenticated');
  });

  it('401 unauthenticated without established session is not session expiry', () => {
    const mapped = mapApiErrorToUxState(
      api({ status: 401, code: 'unauthenticated', title: 'Authentication required' }),
    );
    expect(mapped.kind).toBe('generic');
    expect(mapped.kind).not.toBe('session_unauthenticated');
  });

  it('403 csrf_failed is CSRF recovery, not permission', () => {
    const mapped = mapApiErrorToUxState(
      api({ status: 403, code: 'csrf_failed', title: 'CSRF', detail: 'Invalid token' }),
    );
    expect(mapped.kind).toBe('csrf_failed');
    expect(mapped.retryable).toBe(true);
  });

  it('403 other is permission_denied', () => {
    const mapped = mapApiErrorToUxState(
      api({ status: 403, code: 'forbidden', title: 'Forbidden', detail: 'Not allowed' }),
    );
    expect(mapped.kind).toBe('permission_denied');
  });

  it('404 maps to not_found', () => {
    const mapped = mapApiErrorToUxState(
      api({ status: 404, code: 'not_found', title: 'Not found', detail: 'Missing issue' }),
    );
    expect(mapped.kind).toBe('not_found');
    expect(mapped.retryable).toBe(false);
  });

  it('412 maps to conflict', () => {
    const mapped = mapApiErrorToUxState(
      api({ status: 412, code: 'precondition_failed', title: 'Conflict', detail: 'Stale version' }),
    );
    expect(mapped.kind).toBe('conflict');
    expect(mapped.retryable).toBe(false);
    expect(mapped.recoveryHint).toContain('Reload');
  });

  it('422 maps to validation with first field message', () => {
    const mapped = mapApiErrorToUxState(
      api({
        status: 422,
        code: 'validation_error',
        title: 'Validation failed',
        fieldErrors: [{ field: 'email', message: 'Enter a valid email address.' }],
      }),
    );
    expect(mapped.kind).toBe('validation');
    expect(mapped.description).toBe('Enter a valid email address.');
    expect(mapped.retryable).toBe(false);
  });

  it('429 maps to rate_limit', () => {
    const mapped = mapApiErrorToUxState(
      api({ status: 429, code: 'rate_limited', title: 'Too many requests' }),
    );
    expect(mapped.kind).toBe('rate_limit');
    expect(mapped.retryable).toBe(false);
  });

  it('includes request id when present', () => {
    const mapped = mapApiErrorToUxState(
      api({
        status: 503,
        code: 'service_unavailable',
        title: 'Unavailable',
        requestId: 'req-abc',
      }),
    );
    expect(mapped.showRequestId).toBe(true);
    expect(mapped.requestId).toBe('req-abc');
    expect(mapped.retryable).toBe(true);
  });
});
