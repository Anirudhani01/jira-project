/** High-level UX classification for inline/section errors (not routing). */
export type UxErrorKind =
  | 'generic'
  | 'network'
  | 'transient_server'
  | 'rate_limit'
  | 'permission_denied'
  | 'csrf_failed'
  | 'validation'
  | 'conflict'
  | 'auth_credentials'
  | 'session_unauthenticated'
  | 'not_found';

export interface UxErrorPresentation {
  kind: UxErrorKind;
  title: string;
  description: string;
  requestId: string | null;
  showRequestId: boolean;
  retryable: boolean;
  recoveryHint?: string;
}

export interface MapApiErrorContext {
  hadEstablishedSession?: boolean;
  surface?: 'default' | 'login';
}
