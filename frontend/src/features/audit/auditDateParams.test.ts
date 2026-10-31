import { describe, expect, it } from 'vitest';

import {
  datetimeLocalToIso,
  formatChipDate,
  isoToDatetimeLocalValue,
  parseIsoDateParam,
} from './auditDateParams';

describe('auditDateParams', () => {
  it('parseIsoDateParam rejects invalid values', () => {
    expect(parseIsoDateParam(null)).toBeNull();
    expect(parseIsoDateParam('')).toBeNull();
    expect(parseIsoDateParam('not-a-date')).toBeNull();
    expect(parseIsoDateParam('2026-10-30T10:00:00Z')).toBeInstanceOf(Date);
  });

  it('round-trips datetime-local through ISO', () => {
    const iso = '2026-10-30T10:00:00.000Z';
    const local = isoToDatetimeLocalValue(iso);
    expect(local).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    const back = datetimeLocalToIso(local);
    expect(back).toBeTruthy();
    expect(parseIsoDateParam(back)?.toISOString()).toBe(iso);
  });

  it('datetimeLocalToIso returns null for empty or invalid input', () => {
    expect(datetimeLocalToIso('')).toBeNull();
    expect(datetimeLocalToIso('   ')).toBeNull();
  });

  it('formatChipDate falls back for invalid iso', () => {
    expect(formatChipDate('bad')).toBe('bad');
  });
});
