import type { IssueFieldDraftPayload } from './draftTypes';
import { persistIssueFieldDrafts } from './draftStorage';
import { readIssueDetailDraftSnapshot, snapshotToPayload } from './issueDetailDraft';
import { isCsrfRefreshInProgress } from './csrfRecovery';

export type SessionExpiryPhase = 'idle' | 'handling' | 'awaiting_user' | 'navigating';

export interface SessionExpiryDialogModel {
  nextPath: string;
  recoverableDraft: IssueFieldDraftPayload | null;
  persistError: string | null;
  navigationError: string | null;
}

export interface SessionExpiryControllerEnv {
  getHadEstablishedSession: () => boolean;
  getLogoutIntent: () => boolean;
  isAuthRoute: () => boolean;
  /** True when the router location is the login page (post-navigation verification). */
  isLoginRoute: () => boolean;
  onPhaseChange: (phase: SessionExpiryPhase) => void;
  onDialogChange: (model: SessionExpiryDialogModel | null) => void;
  clearSessionState: () => void;
  navigateToLogin: (nextPath: string) => Promise<void>;
}

let env: SessionExpiryControllerEnv | null = null;
let phase: SessionExpiryPhase = 'idle';
let inflight: Promise<void> | null = null;
let memorySnapshot: IssueFieldDraftPayload | null = null;
let pendingNext = '/';
let pendingExpiryWhileCsrf: string | null = null;
let draftPersistedForFlow = false;

export function configureSessionExpiryController(next: SessionExpiryControllerEnv): void {
  env = next;
}

export function getSessionExpiryPhase(): SessionExpiryPhase {
  return phase;
}

export function isSessionExpiryBlocking(): boolean {
  return phase === 'handling' || phase === 'awaiting_user' || phase === 'navigating';
}

function setPhase(next: SessionExpiryPhase): void {
  phase = next;
  env?.onPhaseChange(next);
}

function dialogModel(overrides: Partial<SessionExpiryDialogModel> = {}): SessionExpiryDialogModel {
  return {
    nextPath: pendingNext,
    recoverableDraft: memorySnapshot,
    persistError: null,
    navigationError: null,
    ...overrides,
  };
}

export function notifyNavigationSettled(): void {
  if (phase === 'navigating') {
    setPhase('idle');
    memorySnapshot = null;
    draftPersistedForFlow = false;
    env?.onDialogChange(null);
  }
}

/** Queue expiry while CSRF refresh runs; flushed when refresh settles. */
export function queueSessionExpiryWhileCsrf(nextPath: string): void {
  pendingExpiryWhileCsrf = nextPath;
}

/** Called after CSRF refresh completes (success or failure). */
export function flushPendingSessionExpiryAfterCsrf(): void {
  const nextPath = pendingExpiryWhileCsrf;
  pendingExpiryWhileCsrf = null;
  if (!nextPath) return;
  void requestSessionExpiry(nextPath);
}

export function notifyNavigationFailed(message: string): void {
  if (phase !== 'navigating' || !env) return;
  setPhase('awaiting_user');
  env.onDialogChange(
    dialogModel({
      navigationError: message,
    }),
  );
}

function shouldIgnoreExpiryRequest(): boolean {
  if (!env) return true;
  if (env.getLogoutIntent() || env.isAuthRoute() || !env.getHadEstablishedSession()) {
    return true;
  }
  return false;
}

export function requestSessionExpiry(nextPath: string): Promise<void> {
  if (!env) return Promise.resolve();
  if (isSessionExpiryBlocking()) return Promise.resolve();
  if (shouldIgnoreExpiryRequest()) return Promise.resolve();
  if (isCsrfRefreshInProgress()) {
    queueSessionExpiryWhileCsrf(nextPath);
    return Promise.resolve();
  }
  if (inflight) return inflight;

  const controllerEnv: SessionExpiryControllerEnv = env;
  inflight = Promise.resolve()
    .then(() => {
      if (shouldIgnoreExpiryRequest()) return;
      pendingNext = nextPath;
      draftPersistedForFlow = false;
      setPhase('handling');

      const snap = readIssueDetailDraftSnapshot();
      memorySnapshot = snap ? snapshotToPayload(snap) : null;

      setPhase('awaiting_user');
      controllerEnv.onDialogChange(dialogModel());
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}

export function onSessionUnauthenticatedError(nextPath: string): void {
  if (isSessionExpiryBlocking()) return;
  void requestSessionExpiry(nextPath);
}

function verifyNavigationReachedLogin(): void {
  if (phase !== 'navigating' || !env) return;
  if (env.isAuthRoute() || env.isLoginRoute()) return;
  notifyNavigationFailed(
    'Sign-in page did not open. Try again or continue without saving a draft.',
  );
}

function startNavigateToLogin(): void {
  if (!env) return;
  setPhase('navigating');
  env.onDialogChange(null);
  env.clearSessionState();
  void (async () => {
    try {
      await env.navigateToLogin(pendingNext);
      queueMicrotask(() => {
        verifyNavigationReachedLogin();
      });
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : 'Could not open the sign-in page. Try again or continue without saving a draft.';
      notifyNavigationFailed(message);
    }
  })();
}

function persistDraftIfNeeded(): void {
  if (!memorySnapshot || draftPersistedForFlow) return;
  persistIssueFieldDrafts([memorySnapshot]);
  draftPersistedForFlow = true;
}

function finalizeNavigate(skipPersist: boolean): void {
  if (!env) return;
  if (phase === 'navigating') return;

  if (!skipPersist && memorySnapshot) {
    try {
      persistDraftIfNeeded();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Could not save your draft for recovery.';
      env.onDialogChange(
        dialogModel({
          persistError: message,
        }),
      );
      setPhase('awaiting_user');
      return;
    }
  }

  startNavigateToLogin();
}

export function confirmSessionExpiryContinue(): void {
  finalizeNavigate(false);
}

export function confirmSessionExpiryWithoutRecovery(): void {
  finalizeNavigate(true);
}

export function retrySessionExpiryPersist(): void {
  finalizeNavigate(false);
}

/** Test helper */
export function resetSessionExpiryControllerForTests(): void {
  phase = 'idle';
  inflight = null;
  memorySnapshot = null;
  pendingNext = '/';
  pendingExpiryWhileCsrf = null;
  draftPersistedForFlow = false;
  env = null;
}
