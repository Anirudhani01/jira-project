import { describe, expect, it } from 'vitest';

import { ApiError } from '../api/errors';
import { firstMappedServerErrorField } from '../forms';

describe('firstMappedServerErrorField', () => {
  const allowed = ['email', 'password'] as const;
  const order = ['email', 'password'] as const;

  it('returns the first mapped field in FIELD_ORDER', () => {
    const error = new ApiError({
      status: 422,
      code: 'validation_error',
      title: 'Validation',
      fieldErrors: [
        { field: 'body.password', message: 'Bad password' },
        { field: 'body.email', message: 'Bad email' },
      ],
    });
    expect(firstMappedServerErrorField(error, order, allowed)).toBe('email');
  });

  it('ignores unmapped API fields', () => {
    const error = new ApiError({
      status: 422,
      code: 'validation_error',
      title: 'Validation',
      fieldErrors: [{ field: 'body.unknown', message: 'Nope' }],
    });
    expect(firstMappedServerErrorField(error, order, allowed)).toBeNull();
  });
});
