import type { AuthenticationActivityItem } from '../../lib/api/types';

import { formatAuthActivityEventType } from './authActivityEventTypes';

const SENSITIVE_KEY_RE =
  /^(ip|user_agent|request_id|email|email_hmac|access_token|refresh_token|password|password_hash|reset_token|reset_secret|platform_event_id)$/i;

/** One metadata entry as a sentence a person can read; null means "nothing worth showing". */
function describeMetadata(key: string, value: unknown): string | null {
  if (key === 'sessions_evicted') {
    const count = Number(value);
    if (!Number.isFinite(count) || count <= 0) return null;
    return `${String(count)} other session${count === 1 ? '' : 's'} signed out`;
  }
  if (key === 'rehashed') return value === true ? 'Password hash upgraded' : null;
  return `${key.replaceAll('_', ' ')}: ${String(value)}`;
}

/** Human-readable summary for the Details column (allowlisted API fields only). */
export function authActivityDetailsSummary(item: AuthenticationActivityItem): string {
  const parts: string[] = [];
  if (item.reason?.trim()) parts.push(item.reason.trim());
  for (const [key, value] of Object.entries(item.metadata)) {
    if (SENSITIVE_KEY_RE.test(key)) continue;
    const text = describeMetadata(key, value);
    if (text) parts.push(text);
  }
  return parts.length > 0 ? parts.join(' · ') : '—';
}

export function authActivitySafeMetadata(
  item: AuthenticationActivityItem,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(item.metadata).filter(([key]) => !SENSITIVE_KEY_RE.test(key)),
  );
}

export function authActivityRowLabel(item: AuthenticationActivityItem): string {
  return `${formatAuthActivityEventType(item.event_type)} for ${item.member_display_name}`;
}
