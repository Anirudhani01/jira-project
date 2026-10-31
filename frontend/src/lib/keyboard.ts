/** True when a key press should be left to the page: the user is typing, a modifier is held, or
 * a modal dialog is open. Used by single-key shortcuts (docs: shortcuts are disabled while
 * typing and when a modal is open). */
export function shouldIgnoreShortcut(event: KeyboardEvent): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey || event.defaultPrevented) return true;
  const target = event.target;
  if (target instanceof HTMLElement) {
    const tag = target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) {
      return true;
    }
  }
  return document.querySelector('[role="dialog"]') !== null;
}
