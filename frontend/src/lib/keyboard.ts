let enabled = true;

/** Master switch for single-key shortcuts (the user can turn them off in the help dialog;
 * `Ctrl/Cmd+K` and the Help button keep working so shortcuts can be turned back on). */
export function setShortcutsEnabled(value: boolean): void {
  enabled = value;
}

export function areShortcutsEnabled(): boolean {
  return enabled;
}

/** True when the key press happened while the user is typing in a field. */
export function isTypingTarget(event: KeyboardEvent): boolean {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

/** True when a single-key shortcut should be left alone: shortcuts are off, a modifier is held,
 * the user is typing, or a modal dialog is open (docs/ux: shortcuts are disabled while typing
 * and when a modal is open). */
export function shouldIgnoreShortcut(event: KeyboardEvent): boolean {
  if (!enabled) return true;
  if (event.ctrlKey || event.metaKey || event.altKey || event.defaultPrevented) return true;
  if (isTypingTarget(event)) return true;
  return document.querySelector('[role="dialog"]') !== null;
}
