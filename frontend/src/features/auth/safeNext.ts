/**
 * Validate a post-login redirect target. Only same-origin, absolute paths are allowed,
 * so `?next=` cannot be used as an open redirect (e.g. `//evil.test` or `https://...`).
 */
export function safeNext(value: string | null | undefined, fallback = '/'): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) {
    return fallback;
  }
  try {
    const url = new URL(value, 'https://placeholder.invalid');
    if (url.origin !== 'https://placeholder.invalid') return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}
