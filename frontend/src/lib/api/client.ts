import { apiErrorFromResponse, networkError } from './errors';

/** All API routes live under this same-origin prefix. */
export const API_BASE = '/api/v1';

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  /** JSON-serialisable request body. */
  json?: unknown;
}

/**
 * Minimal typed fetch wrapper.
 * - Same-origin credentials only (session cookie); no tokens in JS.
 * - Non-2xx responses and network failures always reject with ApiError.
 * - Typed request/response models arrive with OpenAPI type generation in M1.
 */
export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { json, headers, ...init } = options;
  const requestHeaders = new Headers(headers);
  requestHeaders.set('Accept', 'application/json');
  if (json !== undefined) requestHeaders.set('Content-Type', 'application/json');

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      credentials: 'same-origin',
      headers: requestHeaders,
      ...(json !== undefined ? { body: JSON.stringify(json) } : {}),
    });
  } catch (cause) {
    throw networkError(cause);
  }

  if (!response.ok) throw await apiErrorFromResponse(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
