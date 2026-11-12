/** Local-time date helpers for the date range picker. Everything works on calendar fields
 * (year, month, day), never on millisecond offsets across days, so daylight saving changes
 * cannot shift a day. */

/** 0 = Sunday … 6 = Saturday (the same numbering as `Date#getDay`). */
export type WeekStart = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface DateRange {
  from: Date | null;
  to: Date | null;
}

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function endOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

/** The day `count` days away (negative goes back), at midnight. */
export function addDays(date: Date, count: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + count);
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

/** The same day of the month `count` months away, clamped to the last day when the target month
 * is shorter (31 Jan + 1 month = 28/29 Feb), at midnight. */
export function addMonths(date: Date, count: number): Date {
  const target = new Date(date.getFullYear(), date.getMonth() + count, 1);
  const day = Math.min(date.getDate(), daysInMonth(target.getFullYear(), target.getMonth()));
  return new Date(target.getFullYear(), target.getMonth(), day);
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Negative when `a` is an earlier day than `b`, 0 on the same day, positive when later. */
export function compareDays(a: Date, b: Date): number {
  return startOfDay(a).getTime() - startOfDay(b).getTime();
}

/** Six weeks of seven days covering `month` (0–11), starting on `weekStart`, so the grid keeps a
 * constant height from month to month. Days of the neighbouring months fill the edges. */
export function monthGrid(year: number, month: number, weekStart: WeekStart): Date[][] {
  const first = new Date(year, month, 1);
  const lead = (first.getDay() - weekStart + 7) % 7;
  return Array.from({ length: 6 }, (_, week) =>
    Array.from({ length: 7 }, (_, day) => new Date(year, month, 1 - lead + week * 7 + day)),
  );
}

/** Week order of seven days starting on `weekStart`, for the column headers. */
export function weekdayOrder(weekStart: WeekStart): number[] {
  return Array.from({ length: 7 }, (_, index) => (weekStart + index) % 7);
}

/** First day of the week for a locale (`Intl.Locale#weekInfo`, or `getWeekInfo()` in newer
 * engines); Sunday when the engine does not know. */
export function weekStartFor(locale: string | undefined): WeekStart {
  try {
    const intlLocale = new Intl.Locale(locale ?? navigator.language) as Intl.Locale & {
      weekInfo?: { firstDay: number };
      getWeekInfo?: () => { firstDay: number };
    };
    const info = intlLocale.getWeekInfo?.() ?? intlLocale.weekInfo;
    if (info && info.firstDay >= 1 && info.firstDay <= 7) {
      return (info.firstDay % 7) as WeekStart; // ISO 1–7 (7 = Sunday) → 0–6
    }
  } catch {
    /* unsupported locale or engine */
  }
  return 0;
}

export type DatePresetId = 'any' | 'hour' | 'day' | 'week' | 'month';

export const DATE_PRESETS: { id: DatePresetId; label: string }[] = [
  { id: 'any', label: 'Any time' },
  { id: 'hour', label: 'Last hour' },
  { id: 'day', label: 'Last 24 hours' },
  { id: 'week', label: 'Last 7 days' },
  { id: 'month', label: 'Last 30 days' },
];

/** The range a preset stands for, ending at `now`. "Any time" clears both ends. */
export function presetRange(id: DatePresetId, now: Date = new Date()): DateRange {
  const back = (days: number) =>
    new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - days,
      now.getHours(),
      now.getMinutes(),
      now.getSeconds(),
    );
  switch (id) {
    case 'any':
      return { from: null, to: null };
    case 'hour':
      return { from: new Date(now.getTime() - 3_600_000), to: now };
    case 'day':
      return { from: back(1), to: now };
    case 'week':
      return { from: back(7), to: now };
    case 'month':
      return { from: back(30), to: now };
  }
}

/** Put the two ends in order: a later start and an earlier end swap places. */
export function normaliseRange(range: DateRange): DateRange {
  const { from, to } = range;
  if (from && to && from.getTime() > to.getTime()) return { from: to, to: from };
  return range;
}

function parseIso(value: string | null | undefined): Date | null {
  if (!value?.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** ISO instants (as kept in the URL) to dates; empty or invalid values become `null`. */
export function isoToRange(
  from: string | null | undefined,
  to: string | null | undefined,
): DateRange {
  return { from: parseIso(from), to: parseIso(to) };
}

/** Dates to ISO instants for the URL and the API; a missing end stays `null`. */
export function rangeToIso(range: DateRange): { from: string | null; to: string | null } {
  return {
    from: range.from ? range.from.toISOString() : null,
    to: range.to ? range.to.toISOString() : null,
  };
}

/** `HH:mm` of a date, for a time input. */
export function timeValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** The day of `day` at the `HH:mm` of `time` (an invalid or empty time falls back to the start or
 * end of the day). A `start` is the first instant of its minute, an `end` the last. */
export function withTime(day: Date, time: string, fallback: 'start' | 'end'): Date {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  const hours = match ? Number(match[1]) : fallback === 'start' ? 0 : 23;
  const minutes = match ? Number(match[2]) : fallback === 'start' ? 0 : 59;
  // An end time is inclusive to the end of that minute, so 23:59 means the end of the day.
  const seconds = fallback === 'end' ? 59 : 0;
  const millis = fallback === 'end' ? 999 : 0;
  return new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate(),
    hours,
    minutes,
    seconds,
    millis,
  );
}

const DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});
const TIME_FORMAT = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

function boundLabel(date: Date, bound: 'start' | 'end'): string {
  const isDefault =
    bound === 'start'
      ? date.getHours() === 0 && date.getMinutes() === 0
      : date.getHours() === 23 && date.getMinutes() === 59;
  return isDefault
    ? DATE_FORMAT.format(date)
    : `${DATE_FORMAT.format(date)} ${TIME_FORMAT.format(date)}`;
}

/** Short text for the picker's button: "Any time", "13 Nov 2026", "13 Nov 2026 – 20 Nov 2026",
 * "From …" or "Until …". Times show only when they are not the start or end of the day. */
export function formatRangeLabel(range: DateRange): string {
  const { from, to } = range;
  if (from && to) {
    if (isSameDay(from, to) && boundLabel(from, 'start') === DATE_FORMAT.format(from)) {
      if (boundLabel(to, 'end') === DATE_FORMAT.format(to)) return DATE_FORMAT.format(from);
    }
    return `${boundLabel(from, 'start')} – ${boundLabel(to, 'end')}`;
  }
  if (from) return `From ${boundLabel(from, 'start')}`;
  if (to) return `Until ${boundLabel(to, 'end')}`;
  return 'Any time';
}
