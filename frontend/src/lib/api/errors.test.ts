import { ApiError, apiErrorFromResponse, networkError } from './errors';

function problemResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/problem+json', ...headers },
  });
}

describe('apiErrorFromResponse', () => {
  it('maps a problem+json body', async () => {
    const error = await apiErrorFromResponse(
      problemResponse(422, {
        type: 'urn:problem:validation_error',
        title: 'Validation failed',
        status: 422,
        code: 'validation_error',
        detail: 'The request is invalid.',
        request_id: 'req-123',
        errors: [{ field: 'body.name', message: 'too long' }, { bogus: true }],
      }),
    );
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(422);
    expect(error.code).toBe('validation_error');
    expect(error.title).toBe('Validation failed');
    expect(error.detail).toBe('The request is invalid.');
    expect(error.requestId).toBe('req-123');
    expect(error.fieldErrors).toEqual([{ field: 'body.name', message: 'too long' }]);
    expect(error.isTransient).toBe(false);
  });

  it('falls back gracefully for non-JSON bodies and uses the request-id header', async () => {
    const error = await apiErrorFromResponse(
      new Response('<html>Bad Gateway</html>', {
        status: 502,
        statusText: 'Bad Gateway',
        headers: { 'x-request-id': 'hdr-456' },
      }),
    );
    expect(error.code).toBe('http_502');
    expect(error.title).toBe('Bad Gateway');
    expect(error.detail).toBeNull();
    expect(error.requestId).toBe('hdr-456');
    expect(error.fieldErrors).toEqual([]);
    expect(error.isTransient).toBe(true);
  });

  it('ignores non-string fields from untrusted bodies', async () => {
    const error = await apiErrorFromResponse(
      problemResponse(404, { code: 42, title: { x: 1 }, detail: ['nope'] }),
    );
    expect(error.code).toBe('http_404');
    expect(error.detail).toBeNull();
  });
});

describe('networkError', () => {
  it('is a transient status-0 error that keeps the cause', () => {
    const cause = new TypeError('Failed to fetch');
    const error = networkError(cause);
    expect(error.status).toBe(0);
    expect(error.isNetworkError).toBe(true);
    expect(error.isTransient).toBe(true);
    expect(error.cause).toBe(cause);
  });
});
