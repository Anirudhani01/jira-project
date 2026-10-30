/** Clears client-side "had a session" UX flags after confirmed logout (not on logout failure). */
let onConfirmedLogout: (() => void) | null = null;

export function registerEstablishedSessionLifecycle(hooks: {
  onConfirmedLogout: () => void;
}): void {
  onConfirmedLogout = hooks.onConfirmedLogout;
}

export function notifyConfirmedLogout(): void {
  onConfirmedLogout?.();
}

export function resetEstablishedSessionLifecycleForTests(): void {
  onConfirmedLogout = null;
}
