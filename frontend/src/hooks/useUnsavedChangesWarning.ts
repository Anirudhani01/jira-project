import { useEffect } from 'react';
import { useBlocker, useBeforeUnload } from 'react-router';

const DEFAULT_MESSAGE = 'You have unsaved changes. Leave this page anyway?';

/**
 * Warn on tab close and in-app navigation when a draft is dirty.
 */
export function useUnsavedChangesWarning(dirty: boolean, message = DEFAULT_MESSAGE) {
  useBeforeUnload(
    (event) => {
      if (!dirty) return;
      event.preventDefault();
    },
    { capture: true },
  );

  const blocker = useBlocker(dirty);

  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    if (window.confirm(message)) blocker.proceed();
    else blocker.reset();
  }, [blocker, message]);
}
