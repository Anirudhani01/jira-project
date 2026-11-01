/** Curated IANA zones for org settings; current value is always included when absent. */
export const COMMON_TIMEZONES = [
  'UTC',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/New_York',
  'America/Sao_Paulo',
  'America/Toronto',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Sydney',
  'Europe/Berlin',
  'Europe/London',
  'Europe/Paris',
  'Pacific/Auckland',
] as const;

/** Common BCP 47 tags; org-specific values are appended when not listed. */
export const COMMON_LOCALES = [
  'de-DE',
  'en-GB',
  'en-US',
  'es-ES',
  'fr-FR',
  'ja-JP',
  'pt-BR',
  'zh-CN',
  'zh-Hans-CN',
] as const;

function withCurrent(options: readonly string[], current: string): string[] {
  const values = new Set<string>(options);
  if (current.trim()) values.add(current);
  return [...values].sort((a, b) => a.localeCompare(b));
}

export function timezoneSelectOptions(current: string): string[] {
  return withCurrent(COMMON_TIMEZONES, current);
}

export function localeSelectOptions(current: string): string[] {
  return withCurrent(COMMON_LOCALES, current);
}
