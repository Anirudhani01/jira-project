import { formatChipDate, parseIsoDateParam } from '../audit/auditDateParams';

import {
  formatAuthActivityEventType,
  isKnownAuthActivityEventType,
} from './authActivityEventTypes';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const AUTH_ACTIVITY_FILTER_KEYS = ['member', 'event_type', 'from', 'to'] as const;
export type AuthActivityFilterKey = (typeof AUTH_ACTIVITY_FILTER_KEYS)[number];

export const AUTH_ACTIVITY_FILTER_LABEL: Record<AuthActivityFilterKey, string> = {
  member: 'Member',
  event_type: 'Event type',
  from: 'From',
  to: 'To',
};

export type ParsedAuthActivitySearch = {
  member?: string;
  event_type?: string;
  from?: string;
  to?: string;
  invalid: { from?: boolean; to?: boolean; member?: boolean; event_type?: boolean };
};

export function parseAuthActivitySearchParams(
  searchParams: URLSearchParams,
): ParsedAuthActivitySearch {
  const invalid: ParsedAuthActivitySearch['invalid'] = {};

  const memberRaw = searchParams.get('member')?.trim();
  let member: string | undefined;
  if (memberRaw) {
    if (UUID_RE.test(memberRaw)) member = memberRaw;
    else invalid.member = true;
  }

  const eventTypeRaw = searchParams.get('event_type')?.trim();
  let event_type: string | undefined;
  if (eventTypeRaw) {
    if (isKnownAuthActivityEventType(eventTypeRaw)) event_type = eventTypeRaw;
    else invalid.event_type = true;
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

  const result: ParsedAuthActivitySearch = { invalid };
  if (member) result.member = member;
  if (event_type) result.event_type = event_type;
  if (from) result.from = from;
  if (to) result.to = to;
  return result;
}

export function authActivityFiltersForApi(parsed: ParsedAuthActivitySearch): {
  member?: string;
  event_type?: string;
  from?: string;
  to?: string;
} {
  const filters: { member?: string; event_type?: string; from?: string; to?: string } = {};
  if (parsed.member) filters.member = parsed.member;
  if (parsed.event_type && !parsed.invalid.event_type) filters.event_type = parsed.event_type;
  if (parsed.from) filters.from = parsed.from;
  if (parsed.to) filters.to = parsed.to;
  return filters;
}

export function formatAuthActivityChipValue(
  key: AuthActivityFilterKey,
  value: string,
  memberLabel?: string,
): string {
  if (key === 'member') return memberLabel ?? value;
  if (key === 'event_type') return formatAuthActivityEventType(value);
  return formatChipDate(value);
}

export function hasActiveAuthActivityFilters(searchParams: URLSearchParams): boolean {
  return AUTH_ACTIVITY_FILTER_KEYS.some((name) => Boolean(searchParams.get(name)?.trim()));
}
