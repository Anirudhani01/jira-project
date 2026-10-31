import type {
  Control,
  FieldErrors,
  FieldValues,
  Path,
  UseFormSetError,
  UseFormSetFocus,
} from 'react-hook-form';

import { applyServerErrors, firstMappedServerErrorField } from '../forms';

function isFieldRegistered<T extends FieldValues>(control: Control<T>, name: Path<T>): boolean {
  return control._names.mount.has(name);
}

/** Focus the first invalid field in order that is registered and mounted. */
export function focusFirstInvalidInOrder<T extends FieldValues>(
  control: Control<T>,
  setFocus: UseFormSetFocus<T>,
  fieldOrder: readonly Path<T>[],
  errors: FieldErrors<T>,
): void {
  for (const name of fieldOrder) {
    if (!errors[name]) continue;
    if (!isFieldRegistered(control, name)) continue;
    setFocus(name);
    return;
  }
}

export function focusMappedServerErrorField<T extends FieldValues>(
  control: Control<T>,
  setFocus: UseFormSetFocus<T>,
  error: unknown,
  fieldOrder: readonly Path<T>[],
  allowedFields: readonly Path<T>[],
): void {
  const first = firstMappedServerErrorField(error, fieldOrder, allowedFields);
  if (!first) return;
  if (!isFieldRegistered(control, first)) return;
  setFocus(first);
}

/** Map server errors, then focus the first mapped registered field. applyServerErrors behavior unchanged. */
export function applyServerErrorsWithFocus<T extends FieldValues>(
  error: unknown,
  fieldOrder: readonly Path<T>[],
  allowedFields: readonly Path<T>[],
  setError: UseFormSetError<T>,
  control: Control<T>,
  setFocus: UseFormSetFocus<T>,
): boolean {
  const applied = applyServerErrors(error, allowedFields, setError);
  if (!applied) return false;
  focusMappedServerErrorField(control, setFocus, error, fieldOrder, allowedFields);
  return true;
}
