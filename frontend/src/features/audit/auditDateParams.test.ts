import { describe, expect, it } from 'vitest';

import { applyDateRangeParams, formatChipDate, parseIsoDateParam } from './auditDateParams';

describe('auditDateParams', () => {
  it('parseIsoDateParam rejects invalid values', () => {
    expect(parseIsoDateParam(null)).toBeNull();
    expect(parseIsoDateParam('')).toBeNull();
    expect(parseIsoDateParam('not-a-date')).toBeNull();
    expect(parseIsoDateParam('2026-10-30T10:00:00Z')).toBeInstanceOf(Date);
  });

  it('formatChipDate falls back for invalid iso', () => {
    expect(formatChipDate('bad')).toBe('bad');
  });

  it('applyDateRangeParams sets both ends, removes empty ones and keeps other params', () => {
    const base = new URLSearchParams('action=project.created&from=2026-01-01T00:00:00.000Z');
    const both = applyDateRangeParams(base, {
      from: '2026-11-10T00:00:00.000Z',
      to: '2026-11-15T23:59:59.999Z',
    });
    expect(both.get('from')).toBe('2026-11-10T00:00:00.000Z');
    expect(both.get('to')).toBe('2026-11-15T23:59:59.999Z');
    expect(both.get('action')).toBe('project.created');

    const openEnded = applyDateRangeParams(both, { from: '2026-11-10T00:00:00.000Z', to: null });
    expect(openEnded.has('to')).toBe(false);
    expect(openEnded.get('from')).toBe('2026-11-10T00:00:00.000Z');

    const cleared = applyDateRangeParams(openEnded, { from: null, to: null });
    expect(cleared.has('from')).toBe(false);
    expect(cleared.toString()).toBe('action=project.created');
    expect(base.get('from')).toBe('2026-01-01T00:00:00.000Z'); // the input is not mutated
  });
});
