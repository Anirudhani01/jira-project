/** Parse ISO date-time strings from audit URL filters. */
export function parseIsoDateParam(value: string | null | undefined): Date | null {
  if (!value?.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Format an ISO instant for a `datetime-local` input (local timezone). */
export function isoToDatetimeLocalValue(iso: string | null | undefined): string {
  const date = parseIsoDateParam(iso ?? null);
  if (!date) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Convert `datetime-local` value to ISO for the URL/API, or null when empty/invalid. */
export function datetimeLocalToIso(local: string): string | null {
  if (!local.trim()) return null;
  const date = new Date(local);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

export function formatChipDate(iso: string): string {
  const date = parseIsoDateParam(iso);
  return date ? date.toLocaleString() : iso;
}
