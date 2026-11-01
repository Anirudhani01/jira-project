import type { AuthenticationActivityItem } from '../../lib/api/types';

import { formatAuthActivityEventType } from './authActivityEventTypes';

const SENSITIVE_KEY_RE =
  /^(ip|user_agent|request_id|email|email_hmac|access_token|refresh_token|password|password_hash|reset_token|reset_secret|platform_event_id)$/i;

/** Human-readable summary for the Details column (allowlisted API fields only). */
export function authActivityDetailsSummary(item: AuthenticationActivityItem): string {
  const parts: string[] = [];
  if (item.reason?.trim()) parts.push(item.reason.trim());
  const metaParts = Object.entries(item.metadata)
    .filter(([key]) => !SENSITIVE_KEY_RE.test(key))
    .map(([key, value]) => `${key}: ${String(value)}`);
  parts.push(...metaParts);
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
