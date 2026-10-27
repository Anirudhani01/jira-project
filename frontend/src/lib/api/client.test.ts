import { shouldRetryQuery } from '../queryClient';

import { apiFetch } from './client';
import { ApiError } from './errors';

function mockFetch(implementation: (...args: Parameters<typeof fetch>) => Promise<Response>) {
  const spy = vi.fn(implementation);
  vi.stubGlobal('fetch', spy);
  return spy;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('apiFetch', () => {
  it('requests same-origin JSON under the API prefix', async () => {
    const spy = mockFetch(() => Promise.resolve(Response.json({ ok: true })));

    await expect(
      apiFetch<{ ok: boolean }>('/things', { method: 'POST', json: { a: 1 } }),
    ).resolves.toEqual({ ok: true });

    const [url, init] = spy.mock.calls[0] ?? [];
    expect(url).toBe('/api/v1/things');
    expect(init?.credentials).toBe('same-origin');
    expect(init?.body).toBe('{"a":1}');
    const headers = new Headers(init?.headers);
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.get('accept')).toBe('application/json');
  });

  it('returns undefined for 204 responses', async () => {
    mockFetch(() => Promise.resolve(new Response(null, { status: 204 })));
    await expect(apiFetch('/things/1', { method: 'DELETE' })).resolves.toBeUndefined();
  });

  it('rejects with ApiError for problem responses', async () => {
    mockFetch(() =>
      Promise.resolve(
        Response.json(
          { code: 'not_found', title: 'Not found', status: 404, request_id: 'r-1' },
          { status: 404 },
        ),
      ),
    );
    const error: unknown = await apiFetch('/missing').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('not_found');
    expect((error as ApiError).requestId).toBe('r-1');
  });

  it('rejects with a network ApiError when fetch fails', async () => {
    mockFetch(() => Promise.reject(new TypeError('Failed to fetch')));
    const error: unknown = await apiFetch('/things').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).isNetworkError).toBe(true);
  });
});

describe('shouldRetryQuery', () => {
  const transient = new ApiError({ status: 503, code: 'service_unavailable', title: 'x' });
  const clientError = new ApiError({ status: 404, code: 'not_found', title: 'x' });

  it('retries transient errors up to three times', () => {
    expect(shouldRetryQuery(0, transient)).toBe(true);
    expect(shouldRetryQuery(2, transient)).toBe(true);
    expect(shouldRetryQuery(3, transient)).toBe(false);
  });

  it('never retries client errors or unknown errors', () => {
    expect(shouldRetryQuery(0, clientError)).toBe(false);
    expect(shouldRetryQuery(0, new Error('boom'))).toBe(false);
  });
});
