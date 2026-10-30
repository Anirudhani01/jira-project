import { ApiError } from '../api/errors';
import { describeError } from '../forms';

import type { MapApiErrorContext, UxErrorPresentation } from './types';

const GENERIC: UxErrorPresentation = {
  kind: 'generic',
  title: 'Something went wrong',
  description: 'Something went wrong. Please try again.',
  requestId: null,
  showRequestId: false,
  retryable: false,
};

function withRequestId(base: UxErrorPresentation, error: ApiError): UxErrorPresentation {
  const requestId = error.requestId;
  return {
    ...base,
    requestId,
    showRequestId: Boolean(requestId),
  };
}

/** Map API failures to user-facing inline error presentation (status + code aware). */
export function mapApiErrorToUxState(
  error: unknown,
  context: MapApiErrorContext = {},
): UxErrorPresentation {
  if (!(error instanceof ApiError)) {
    return { ...GENERIC };
  }

  const { hadEstablishedSession = false, surface = 'default' } = context;

  if (error.isNetworkError) {
    return {
      kind: 'network',
      title: 'Connection problem',
      description: describeError(error),
      requestId: null,
      showRequestId: false,
      retryable: true,
      recoveryHint: 'Check your connection and try again.',
    };
  }

  if (error.status === 429) {
    return withRequestId(
      {
        kind: 'rate_limit',
        title: 'Too many requests',
        description: describeError(error),
        requestId: null,
        showRequestId: false,
        retryable: false,
      },
      error,
    );
  }

  if (error.status === 401) {
    if (surface === 'login' || error.code === 'invalid_credentials') {
      return {
        kind: 'auth_credentials',
        title: 'Sign-in failed',
        description: 'Email or password is incorrect.',
        requestId: null,
        showRequestId: false,
        retryable: false,
      };
    }
    if (error.code === 'unauthenticated' && hadEstablishedSession) {
      return {
        kind: 'session_unauthenticated',
        title: 'Session expired',
        description: 'Sign in again to continue. Unsaved work may be restored when you return.',
        requestId: null,
        showRequestId: false,
        retryable: false,
      };
    }
    return withRequestId(
      {
        kind: 'generic',
        title: 'Something went wrong',
        description: error.detail ?? describeError(error),
        requestId: null,
        showRequestId: false,
        retryable: false,
      },
      error,
    );
  }

  if (error.status === 403) {
    if (error.code === 'csrf_failed') {
      return withRequestId(
        {
          kind: 'csrf_failed',
          title: 'Request could not be verified',
          description:
            error.detail ?? 'Your session token may be out of date. Refresh the page or try again.',
          requestId: null,
          showRequestId: false,
          retryable: true,
          recoveryHint: 'If this keeps happening, sign out and sign back in.',
        },
        error,
      );
    }
    return withRequestId(
      {
        kind: 'permission_denied',
        title: 'Permission denied',
        description: error.detail ?? error.title,
        requestId: null,
        showRequestId: false,
        retryable: false,
      },
      error,
    );
  }

  if (error.status === 404) {
    return withRequestId(
      {
        kind: 'not_found',
        title: 'Not found',
        description: error.detail ?? describeError(error),
        requestId: null,
        showRequestId: false,
        retryable: false,
      },
      error,
    );
  }

  if (error.status === 412) {
    return withRequestId(
      {
        kind: 'conflict',
        title: 'Version conflict',
        description:
          error.detail ??
          'Someone else changed this record. Your edits were not saved; review and try again.',
        requestId: null,
        showRequestId: false,
        retryable: false,
        recoveryHint: 'Reload the latest version before saving.',
      },
      error,
    );
  }

  if (error.status === 422) {
    const firstField = error.fieldErrors[0]?.message;
    return withRequestId(
      {
        kind: 'validation',
        title: 'Check highlighted fields',
        description: firstField ?? error.detail ?? describeError(error),
        requestId: null,
        showRequestId: false,
        retryable: false,
      },
      error,
    );
  }

  if (error.status === 502 || error.status === 503 || error.status === 504 || error.isTransient) {
    return withRequestId(
      {
        kind: 'transient_server',
        title: 'Temporary problem',
        description: describeError(error),
        requestId: null,
        showRequestId: false,
        retryable: true,
      },
      error,
    );
  }

  if (error.status >= 500) {
    return withRequestId(
      {
        kind: 'transient_server',
        title: 'Server error',
        description: describeError(error),
        requestId: null,
        showRequestId: false,
        retryable: true,
      },
      error,
    );
  }

  return withRequestId(
    {
      kind: 'generic',
      title: 'Something went wrong',
      description: error.detail ?? describeError(error),
      requestId: null,
      showRequestId: false,
      retryable: false,
    },
    error,
  );
}

export const genericUxErrorPresentation = GENERIC;
