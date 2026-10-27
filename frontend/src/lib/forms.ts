import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';

import { ApiError } from './api/errors';

/** Map problem+json field errors (`body.<field>`) onto form fields. True if any applied. */
export function applyServerErrors<T extends FieldValues>(
  error: unknown,
  fields: readonly Path<T>[],
  setError: UseFormSetError<T>,
): boolean {
  if (!(error instanceof ApiError)) return false;
  let applied = false;
  for (const fieldError of error.fieldErrors) {
    const name = fieldError.field.replace(/^body\./, '') as Path<T>;
    if (fields.includes(name)) {
      setError(name, { type: 'server', message: fieldError.message });
      applied = true;
    }
  }
  return applied;
}

/** A user-facing sentence for an API failure that is not tied to one field. */
export function describeError(error: unknown): string {
  if (!(error instanceof ApiError)) return 'Something went wrong. Please try again.';
  if (error.isNetworkError) return 'The server could not be reached. Check your connection.';
  if (error.status === 429) return 'Too many attempts. Please wait a minute and try again.';
  if (error.status >= 500) return 'Something went wrong on our side. Please try again.';
  return error.detail ?? error.title;
}
