import {
  createFallbackOrgFormatters,
  createOrgFormatters,
  ORG_FORMAT_FALLBACK_LOCALE,
  ORG_FORMAT_FALLBACK_TIMEZONE,
} from './orgFormatting';

describe('createOrgFormatters', () => {
  it('formats date/time in Asia/Kolkata versus UTC', () => {
    const utc = createOrgFormatters({ timezone: 'UTC', locale: 'en-US' });
    const kolkata = createOrgFormatters({ timezone: 'Asia/Kolkata', locale: 'en-US' });
    const iso = '2026-06-15T18:30:00.000Z';
    expect(utc.formatDateTime(iso)).not.toEqual(kolkata.formatDateTime(iso));
    expect(kolkata.formatDateTime(iso)).toMatch(/Jun 16, 2026/);
  });

  it('formats date/time in America/New_York versus UTC', () => {
    const utc = createOrgFormatters({ timezone: 'UTC', locale: 'en-US' });
    const ny = createOrgFormatters({ timezone: 'America/New_York', locale: 'en-US' });
    const iso = '2026-01-15T05:00:00.000Z';
    expect(utc.formatDateTime(iso)).toMatch(/Jan 15, 2026/);
    expect(ny.formatDateTime(iso)).toMatch(/Jan 15, 2026,.*12:00/);
    expect(utc.formatDateTime(iso)).not.toEqual(ny.formatDateTime(iso));
  });

  it('handles US DST spring-forward wall times', () => {
    const ny = createOrgFormatters({ timezone: 'America/New_York', locale: 'en-US' });
    const before = ny.formatDateTime('2026-03-08T06:30:00.000Z');
    const after = ny.formatDateTime('2026-03-08T07:30:00.000Z');
    expect(before).toMatch(/1:30/);
    expect(after).toMatch(/3:30/);
  });

  it('uses calendar dates in the org timezone at local midnight boundaries', () => {
    const utc = createOrgFormatters({ timezone: 'UTC', locale: 'en-US' });
    const ny = createOrgFormatters({ timezone: 'America/New_York', locale: 'en-US' });
    const iso = '2026-01-01T03:30:00.000Z';
    expect(utc.formatDate(iso)).toMatch(/Jan 1, 2026/);
    expect(ny.formatDate(iso)).toMatch(/Dec 31, 2025/);
  });

  it('applies locale to absolute formatting', () => {
    const en = createOrgFormatters({ timezone: 'UTC', locale: 'en-US' });
    const de = createOrgFormatters({ timezone: 'UTC', locale: 'de-DE' });
    const iso = '2026-06-15T12:00:00.000Z';
    expect(en.formatDateTime(iso)).toMatch(/Jun/);
    expect(de.formatDateTime(iso)).toMatch(/15\.06\.2026/);
  });

  it('formats relative time with locale and fixed now without shifting elapsed duration', () => {
    const en = createOrgFormatters({ timezone: 'UTC', locale: 'en-US' });
    const de = createOrgFormatters({ timezone: 'Asia/Kolkata', locale: 'de-DE' });
    const now = new Date('2026-10-30T12:00:00.000Z').getTime();
    const iso = '2026-10-30T11:00:00.000Z';
    expect(en.formatRelativeTime(iso, now)).toMatch(/hour/i);
    expect(de.formatRelativeTime(iso, now)).toMatch(/Stunde/i);
  });

  it('does not mutate ISO inputs', () => {
    const fmt = createOrgFormatters({ timezone: 'UTC', locale: 'en-US' });
    const iso = '2026-10-30T11:00:00.000Z';
    fmt.formatDateTime(iso);
    fmt.formatDate(iso);
    fmt.formatRelativeTime(iso, Date.parse('2026-10-30T12:00:00.000Z'));
    expect(iso).toBe('2026-10-30T11:00:00.000Z');
  });
});

describe('createFallbackOrgFormatters', () => {
  it('documents UTC and en-US defaults', () => {
    const f = createFallbackOrgFormatters();
    expect(f.timezone).toBe(ORG_FORMAT_FALLBACK_TIMEZONE);
    expect(f.locale).toBe(ORG_FORMAT_FALLBACK_LOCALE);
    expect(f.isFallback).toBe(true);
  });
});
