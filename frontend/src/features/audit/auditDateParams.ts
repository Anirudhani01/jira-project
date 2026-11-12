/** Parse ISO date-time strings from audit URL filters. */
export function parseIsoDateParam(value: string | null | undefined): Date | null {
  if (!value?.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** The filter params with `from` and `to` set to the given ISO instants (or removed when null),
 * all other params kept. */
export function applyDateRangeParams(
  params: URLSearchParams,
  range: { from: string | null; to: string | null },
): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const [name, value] of [
    ['from', range.from],
    ['to', range.to],
  ] as const) {
    if (value) next.set(name, value);
    else next.delete(name);
  }
  return next;
}

export function formatChipDate(iso: string): string {
  const date = parseIsoDateParam(iso);
  return date ? date.toLocaleString() : iso;
}
