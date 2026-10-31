import { parseIsoDateParam, formatChipDate } from './auditDateParams';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const AUDIT_FILTER_KEYS = ['action', 'actor', 'from', 'to'] as const;
export type AuditFilterKey = (typeof AUDIT_FILTER_KEYS)[number];

export const AUDIT_FILTER_LABEL: Record<AuditFilterKey, string> = {
  action: 'Action',
  actor: 'Actor',
  from: 'From',
  to: 'To',
};

export type ParsedAuditSearch = {
  action?: string;
  actor?: string;
  from?: string;
  to?: string;
  invalid: { from?: boolean; to?: boolean; actor?: boolean };
};

/** Validated filters for API requests (invalid URL params omitted). */
export function parseAuditSearchParams(searchParams: URLSearchParams): ParsedAuditSearch {
  const invalid: ParsedAuditSearch['invalid'] = {};

  const actionRaw = searchParams.get('action')?.trim();
  const action = actionRaw || undefined;

  const actorRaw = searchParams.get('actor')?.trim();
  let actor: string | undefined;
  if (actorRaw) {
    if (UUID_RE.test(actorRaw)) actor = actorRaw;
    else invalid.actor = true;
  }

  const fromRaw = searchParams.get('from');
  let from: string | undefined;
  if (fromRaw) {
    if (parseIsoDateParam(fromRaw)) from = fromRaw;
    else invalid.from = true;
  }

  const toRaw = searchParams.get('to');
  let to: string | undefined;
  if (toRaw) {
    if (parseIsoDateParam(toRaw)) to = toRaw;
    else invalid.to = true;
  }

  const result: ParsedAuditSearch = { invalid };
  if (action) result.action = action;
  if (actor) result.actor = actor;
  if (from) result.from = from;
  if (to) result.to = to;
  return result;
}

export function auditFiltersForApi(parsed: ParsedAuditSearch): {
  action?: string;
  actor?: string;
  from?: string;
  to?: string;
} {
  const filters: { action?: string; actor?: string; from?: string; to?: string } = {};
  if (parsed.action) filters.action = parsed.action;
  if (parsed.actor) filters.actor = parsed.actor;
  if (parsed.from) filters.from = parsed.from;
  if (parsed.to) filters.to = parsed.to;
  return filters;
}

export function formatFilterChipValue(
  key: AuditFilterKey,
  value: string,
  actorLabel?: string,
): string {
  if (key === 'action') return value;
  if (key === 'actor') return actorLabel ?? value;
  return formatChipDate(value);
}
