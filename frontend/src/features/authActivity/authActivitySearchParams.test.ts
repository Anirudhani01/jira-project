import { describe, expect, it } from 'vitest';

import {
  authActivityFiltersForApi,
  parseAuthActivitySearchParams,
} from './authActivitySearchParams';

describe('authActivitySearchParams', () => {
  it('accepts valid filters and rejects invalid member and event type', () => {
    const params = new URLSearchParams({
      member: '11111111-1111-1111-1111-111111111111',
      event_type: 'auth.logout',
      from: '2026-01-01T00:00:00.000Z',
    });
    const parsed = parseAuthActivitySearchParams(params);
    expect(parsed.member).toBe('11111111-1111-1111-1111-111111111111');
    expect(parsed.event_type).toBe('auth.logout');
    expect(authActivityFiltersForApi(parsed)).toEqual({
      member: '11111111-1111-1111-1111-111111111111',
      event_type: 'auth.logout',
      from: '2026-01-01T00:00:00.000Z',
    });

    const bad = parseAuthActivitySearchParams(
      new URLSearchParams({ member: 'nope', event_type: 'auth.signup.requested' }),
    );
    expect(bad.invalid.member).toBe(true);
    expect(bad.invalid.event_type).toBe(true);
    expect(authActivityFiltersForApi(bad)).toEqual({});
  });
});
