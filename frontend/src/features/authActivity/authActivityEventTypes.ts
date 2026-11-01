/** Matches backend projection allowlist (migration 0018 / Phase 4 API). */
export const AUTH_ACTIVITY_EVENT_TYPES = [
  'auth.login.succeeded',
  'auth.login.failed',
  'auth.logout',
  'auth.password.changed',
  'auth.password_reset.requested',
  'auth.password.reset',
  'auth.session.revoked',
  'auth.rate_limited',
] as const;

export type AuthActivityEventType = (typeof AUTH_ACTIVITY_EVENT_TYPES)[number];

const EVENT_LABELS: Record<AuthActivityEventType, string> = {
  'auth.login.succeeded': 'Sign-in succeeded',
  'auth.login.failed': 'Sign-in failed',
  'auth.logout': 'Signed out',
  'auth.password.changed': 'Password changed',
  'auth.password_reset.requested': 'Password reset requested',
  'auth.password.reset': 'Password reset completed',
  'auth.session.revoked': 'Session revoked',
  'auth.rate_limited': 'Rate limited',
};

export type AuthActivityEventTone = 'success' | 'danger' | 'neutral' | 'warning';

const EVENT_TONES: Record<AuthActivityEventType, AuthActivityEventTone> = {
  'auth.login.succeeded': 'success',
  'auth.login.failed': 'danger',
  'auth.logout': 'neutral',
  'auth.password.changed': 'warning',
  'auth.password_reset.requested': 'neutral',
  'auth.password.reset': 'warning',
  'auth.session.revoked': 'warning',
  'auth.rate_limited': 'danger',
};

export function formatAuthActivityEventType(eventType: string): string {
  if (eventType in EVENT_LABELS) {
    return EVENT_LABELS[eventType as AuthActivityEventType];
  }
  return eventType;
}

export function authActivityEventTone(eventType: string): AuthActivityEventTone {
  if (eventType in EVENT_TONES) {
    return EVENT_TONES[eventType as AuthActivityEventType];
  }
  return eventType.includes('failed') || eventType.includes('rate') ? 'danger' : 'neutral';
}

export function isKnownAuthActivityEventType(value: string): value is AuthActivityEventType {
  return (AUTH_ACTIVITY_EVENT_TYPES as readonly string[]).includes(value);
}
