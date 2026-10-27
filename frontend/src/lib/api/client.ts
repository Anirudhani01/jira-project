import { apiErrorFromResponse, networkError } from './errors';

/** All API routes live under this same-origin prefix. */
export const API_BASE = '/api/v1';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * CSRF token for the current session (from GET /auth/session). Kept in memory only:
 * it is derived from the HttpOnly session cookie server-side and rotates with it.
 */
let csrfToken: string | null = null;

export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  /** JSON-serialisable request body. */
  json?: unknown;
}

/**
 * Minimal typed fetch wrapper.
 * - Same-origin credentials only (session cookie); no auth tokens are readable by JS.
 * - Unsafe methods carry the session-bound X-CSRF-Token when one is known.
 * - Non-2xx responses and network failures always reject with ApiError.
 */
export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { json, headers, ...init } = options;
  const method = (init.method ?? 'GET').toUpperCase();
  const requestHeaders = new Headers(headers);
  requestHeaders.set('Accept', 'application/json');
  if (json !== undefined) requestHeaders.set('Content-Type', 'application/json');
  if (UNSAFE_METHODS.has(method) && csrfToken) requestHeaders.set('X-CSRF-Token', csrfToken);

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      method,
      credentials: 'same-origin',
      headers: requestHeaders,
      ...(json !== undefined ? { body: JSON.stringify(json) } : {}),
    });
  } catch (cause) {
    throw networkError(cause);
  }

  if (!response.ok) throw await apiErrorFromResponse(response);
  if (response.status === 202 || response.status === 204) {
    const text = await response.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }
  return (await response.json()) as T;
}
