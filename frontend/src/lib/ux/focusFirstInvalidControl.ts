import { useEffect, useRef } from 'react';

export type FocusableFieldRef = {
  hasError: boolean;
  focus: () => void;
};

/**
 * Focus the first field with an error for the current submit attempt only.
 * Call with refs built from the current attempt's error state (not stale errors).
 */
export function focusFirstInvalidControl(fields: FocusableFieldRef[]): void {
  for (const field of fields) {
    if (!field.hasError) continue;
    field.focus();
    return;
  }
}

/**
 * Runs focus once per submitAttemptId after errors for that attempt are rendered.
 */
export function useFocusOnSubmitAttempt(
  submitAttemptId: number,
  fields: FocusableFieldRef[],
): void {
  const lastFocusedAttempt = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (submitAttemptId === 0) return;
    if (lastFocusedAttempt.current === submitAttemptId) return;
    if (!fields.some((f) => f.hasError)) return;

    let inner = 0;
    const frame = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => {
        if (!mountedRef.current) return;
        focusFirstInvalidControl(fields);
        lastFocusedAttempt.current = submitAttemptId;
      });
    });

    return () => {
      cancelAnimationFrame(frame);
      if (inner !== 0) cancelAnimationFrame(inner);
    };
  }, [submitAttemptId, fields]);
}
