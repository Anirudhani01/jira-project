import { describe, expect, it } from 'vitest';

import {
  addDays,
  addMonths,
  compareDays,
  endOfDay,
  formatRangeLabel,
  isoToRange,
  isSameDay,
  monthGrid,
  normaliseRange,
  presetRange,
  rangeToIso,
  startOfDay,
  timeValue,
  weekdayOrder,
  weekStartFor,
  withTime,
} from './dateRange';

const d = (y: number, m: number, day: number, h = 0, min = 0) => new Date(y, m - 1, day, h, min);

describe('day helpers', () => {
  it('finds the start and end of a day in local time', () => {
    expect(startOfDay(d(2026, 11, 13, 15, 40))).toEqual(d(2026, 11, 13));
    const end = endOfDay(d(2026, 11, 13, 3));
    expect([end.getHours(), end.getMinutes(), end.getSeconds(), end.getMilliseconds()]).toEqual([
      23, 59, 59, 999,
    ]);
  });

  it('moves by calendar days across month and year ends', () => {
    expect(addDays(d(2026, 11, 30), 1)).toEqual(d(2026, 12, 1));
    expect(addDays(d(2026, 1, 1), -1)).toEqual(d(2025, 12, 31));
    expect(addDays(d(2026, 11, 13, 22), 7)).toEqual(d(2026, 11, 20));
  });

  it('moves by months and clamps to the last day of a shorter month', () => {
    expect(addMonths(d(2026, 1, 31), 1)).toEqual(d(2026, 2, 28));
    expect(addMonths(d(2028, 1, 31), 1)).toEqual(d(2028, 2, 29)); // leap year
    expect(addMonths(d(2026, 12, 15), 1)).toEqual(d(2027, 1, 15));
    expect(addMonths(d(2026, 1, 15), -1)).toEqual(d(2025, 12, 15));
  });

  it('compares days regardless of the time of day', () => {
    expect(isSameDay(d(2026, 11, 13, 1), d(2026, 11, 13, 23))).toBe(true);
    expect(isSameDay(d(2026, 11, 13), d(2026, 12, 13))).toBe(false);
    expect(compareDays(d(2026, 11, 12, 23), d(2026, 11, 13, 1))).toBeLessThan(0);
    expect(compareDays(d(2026, 11, 13, 23), d(2026, 11, 13, 1))).toBe(0);
  });
});

describe('monthGrid', () => {
  it('is six weeks of seven days starting on the chosen weekday (November 2026 starts on a Sunday)', () => {
    const sunday = monthGrid(2026, 10, 0);
    expect(sunday).toHaveLength(6);
    expect(sunday.every((week) => week.length === 7)).toBe(true);
    expect(sunday[0]?.[0]).toEqual(d(2026, 11, 1));
    expect(sunday[4]?.[1]).toEqual(d(2026, 11, 30));
    expect(sunday[5]?.[6]).toEqual(d(2026, 12, 12));
  });

  it('pads the first week with the previous month when the week starts on Monday', () => {
    const monday = monthGrid(2026, 10, 1);
    expect(monday[0]?.[0]).toEqual(d(2026, 10, 26));
    expect(monday[0]?.[6]).toEqual(d(2026, 11, 1));
    expect(monday[5]?.[6]).toEqual(d(2026, 12, 6));
  });

  it('lists the weekday numbers in column order', () => {
    expect(weekdayOrder(0)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(weekdayOrder(1)).toEqual([1, 2, 3, 4, 5, 6, 0]);
  });

  it('falls back to Sunday for an unknown locale', () => {
    expect(weekStartFor('not a locale!!')).toBe(0);
  });
});

describe('presets and ranges', () => {
  const now = d(2026, 11, 13, 10, 30);

  it('computes the quick ranges ending now', () => {
    expect(presetRange('any', now)).toEqual({ from: null, to: null });
    expect(presetRange('hour', now)).toEqual({ from: d(2026, 11, 13, 9, 30), to: now });
    expect(presetRange('day', now)).toEqual({ from: d(2026, 11, 12, 10, 30), to: now });
    expect(presetRange('week', now)).toEqual({ from: d(2026, 11, 6, 10, 30), to: now });
    expect(presetRange('month', now)).toEqual({ from: d(2026, 10, 14, 10, 30), to: now });
  });

  it('swaps a reversed range and leaves open or ordered ranges alone', () => {
    const early = d(2026, 11, 1);
    const late = d(2026, 11, 20);
    expect(normaliseRange({ from: late, to: early })).toEqual({ from: early, to: late });
    expect(normaliseRange({ from: early, to: late })).toEqual({ from: early, to: late });
    expect(normaliseRange({ from: early, to: null })).toEqual({ from: early, to: null });
  });

  it('round-trips instants through ISO strings and maps empty or invalid values to null', () => {
    const range = { from: d(2026, 11, 13, 9, 30), to: d(2026, 11, 20, 17, 5) };
    const iso = rangeToIso(range);
    expect(isoToRange(iso.from, iso.to)).toEqual(range);
    expect(rangeToIso({ from: null, to: null })).toEqual({ from: null, to: null });
    expect(isoToRange('', '   ')).toEqual({ from: null, to: null });
    expect(isoToRange('not-a-date', undefined)).toEqual({ from: null, to: null });
  });
});

describe('times', () => {
  it('formats and applies HH:mm, with start-of and end-of day fallbacks', () => {
    expect(timeValue(d(2026, 11, 13, 9, 5))).toBe('09:05');
    expect(withTime(d(2026, 11, 13), '14:45', 'start')).toEqual(d(2026, 11, 13, 14, 45));
    expect(withTime(d(2026, 11, 13), '', 'start')).toEqual(d(2026, 11, 13, 0, 0));
    // An end time covers its whole minute, so 23:59 is the end of the day.
    expect(withTime(d(2026, 11, 13), '14:45', 'end')).toEqual(
      new Date(2026, 10, 13, 14, 45, 59, 999),
    );
    expect(withTime(d(2026, 11, 13), '23:59', 'end')).toEqual(endOfDay(d(2026, 11, 13)));
    const end = withTime(d(2026, 11, 13), '', 'end');
    expect([end.getHours(), end.getMinutes(), end.getSeconds(), end.getMilliseconds()]).toEqual([
      23, 59, 59, 999,
    ]);
  });
});

describe('formatRangeLabel', () => {
  const day = new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  it('says "Any time" when nothing is set', () => {
    expect(formatRangeLabel({ from: null, to: null })).toBe('Any time');
  });

  it('shows a whole single day as one date and a longer range with both ends', () => {
    const from = startOfDay(d(2026, 11, 13));
    expect(formatRangeLabel({ from, to: endOfDay(from) })).toBe(day.format(from));
    const to = endOfDay(d(2026, 11, 20));
    expect(formatRangeLabel({ from, to })).toBe(`${day.format(from)} – ${day.format(to)}`);
  });

  it('adds the time only when it is not the start or end of the day', () => {
    const label = formatRangeLabel({ from: d(2026, 11, 13, 9, 30), to: endOfDay(d(2026, 11, 20)) });
    expect(label).toMatch(/9:30|09:30/);
    expect(label).not.toMatch(/23:59|11:59/);
  });

  it('labels an open end', () => {
    expect(formatRangeLabel({ from: d(2026, 11, 13), to: null })).toBe(
      `From ${day.format(d(2026, 11, 13))}`,
    );
    expect(formatRangeLabel({ from: null, to: endOfDay(d(2026, 11, 20)) })).toBe(
      `Until ${day.format(d(2026, 11, 20))}`,
    );
  });
});
