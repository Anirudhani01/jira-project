/**
 * Client-side representation of the API's RFC 9457 problem+json errors.
 * Every failed request becomes an ApiError so the UI can branch on `status`/`code`.
 */

export interface FieldError {
  field: string;
  message: string;
}

export interface ProblemDetails {
  type?: string;
  title?: string;
  status?: number;
  code?: string;
  detail?: string | null;
  request_id?: string | null;
  errors?: FieldError[];
}

/** Status 0 means the request never produced an HTTP response (network failure). */
export const NETWORK_ERROR_STATUS = 0;

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly title: string;
  readonly detail: string | null;
  readonly requestId: string | null;
  readonly fieldErrors: FieldError[];

  constructor(init: {
    status: number;
    code: string;
    title: string;
    detail?: string | null;
    requestId?: string | null;
    fieldErrors?: FieldError[];
  }) {
    super(init.detail ?? init.title);
    this.name = 'ApiError';
    this.status = init.status;
    this.code = init.code;
    this.title = init.title;
    this.detail = init.detail ?? null;
    this.requestId = init.requestId ?? null;
    this.fieldErrors = init.fieldErrors ?? [];
  }

  get isNetworkError(): boolean {
    return this.status === NETWORK_ERROR_STATUS;
  }

  /** Worth retrying automatically: network failures and transient server errors. */
  get isTransient(): boolean {
    return this.isNetworkError || this.status === 502 || this.status === 503 || this.status === 504;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseFieldErrors(value: unknown): FieldError[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item: unknown) =>
    isRecord(item) && typeof item.field === 'string' && typeof item.message === 'string'
      ? [{ field: item.field, message: item.message }]
      : [],
  );
}

/** Build an ApiError from a non-2xx response, tolerating non-problem bodies. */
export async function apiErrorFromResponse(response: Response): Promise<ApiError> {
  const requestIdHeader = response.headers.get('x-request-id');
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  const problem = isRecord(body) ? body : {};
  const str = (key: string): string | null =>
    typeof problem[key] === 'string' ? problem[key] : null;

  return new ApiError({
    status: response.status,
    code: str('code') ?? `http_${response.status}`,
    title: str('title') ?? (response.statusText || 'Request failed'),
    detail: str('detail'),
    requestId: str('request_id') ?? requestIdHeader,
    fieldErrors: parseFieldErrors(problem.errors),
  });
}

export function networkError(cause: unknown): ApiError {
  const error = new ApiError({
    status: NETWORK_ERROR_STATUS,
    code: 'network_error',
    title: 'Network error',
    detail: 'The server could not be reached. Check your connection and try again.',
  });
  error.cause = cause;
  return error;
}
