import { useEffect, useState } from 'react';

/** Default point at which a pending action is described as slow (docs/ux §5). */
export const SLOW_THRESHOLD_MS = 8000;

/** `true` once an action has been pending longer than `thresholdMs`; resets when it ends.
 * Only a hint for the control that started the request, never a progress claim. */
export function useSlowPending(pending: boolean, thresholdMs: number = SLOW_THRESHOLD_MS): boolean {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!pending) return undefined;
    const timer = setTimeout(() => {
      setSlow(true);
    }, thresholdMs);
    return () => {
      clearTimeout(timer);
      setSlow(false);
    };
  }, [pending, thresholdMs]);
  return pending && slow;
}
