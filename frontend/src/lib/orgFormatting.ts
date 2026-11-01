/** Organization timezone/locale formatting (A5.4). API timestamps stay UTC ISO strings. */

export const ORG_FORMAT_FALLBACK_TIMEZONE = 'UTC';
export const ORG_FORMAT_FALLBACK_LOCALE = 'en-US';

export interface OrgFormatters {
  timezone: string;
  locale: string;
  /** True while org settings are unavailable (loading or error). */
  isFallback: boolean;
  /** Absolute instant in the organization's timezone. */
  formatDateTime(isoUtc: string): string;
  /** Calendar date in the organization's timezone. */
  formatDate(isoUtc: string): string;
  /** Elapsed time from `now`; uses locale only (not timezone wall-clock shift). */
  formatRelativeTime(isoUtc: string, now?: number): string;
}

export function createOrgFormatters(options: {
  timezone: string;
  locale: string;
  isFallback?: boolean;
}): OrgFormatters {
  const { timezone, locale, isFallback = false } = options;

  const dateTimeFormatter = new Intl.DateTimeFormat(locale, {
    timeZone: timezone,
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  const dateFormatter = new Intl.DateTimeFormat(locale, {
    timeZone: timezone,
    dateStyle: 'medium',
  });

  const relativeFormatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });

  return {
    timezone,
    locale,
    isFallback,
    formatDateTime(isoUtc: string) {
      return dateTimeFormatter.format(new Date(isoUtc));
    },
    formatDate(isoUtc: string) {
      return dateFormatter.format(new Date(isoUtc));
    },
    formatRelativeTime(isoUtc: string, now = Date.now()) {
      const then = new Date(isoUtc).getTime();
      const diffSec = Math.round((then - now) / 1000);
      const abs = Math.abs(diffSec);
      if (abs < 60) return relativeFormatter.format(diffSec, 'second');
      if (abs < 3600) return relativeFormatter.format(Math.round(diffSec / 60), 'minute');
      if (abs < 86400) return relativeFormatter.format(Math.round(diffSec / 3600), 'hour');
      return relativeFormatter.format(Math.round(diffSec / 86400), 'day');
    },
  };
}

export function createFallbackOrgFormatters(): OrgFormatters {
  return createOrgFormatters({
    timezone: ORG_FORMAT_FALLBACK_TIMEZONE,
    locale: ORG_FORMAT_FALLBACK_LOCALE,
    isFallback: true,
  });
}
