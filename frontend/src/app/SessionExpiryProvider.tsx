import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useLocation, useNavigate } from 'react-router';

import { UxSessionExpiredDialog } from '../components/ux/UxSessionExpiredDialog';
import { useToast } from '../components/ui/Toast';
import { registerEstablishedSessionLifecycle } from '../features/auth/establishedSession';
import { sessionKey, useSession } from '../features/auth/api';
import { getLogoutIntent } from '../features/auth/logoutIntent';
import { useAuthRoute } from '../features/auth/useAuthRoute';
import { safeNext } from '../features/auth/safeNext';
import { setCsrfToken } from '../lib/api/client';
import { setCacheErrorHandlers } from '../lib/ux/cacheErrorDispatch';
import { isCsrfRefreshInProgress } from '../lib/ux/csrfRecovery';
import {
  configureSessionExpiryController,
  confirmSessionExpiryContinue,
  confirmSessionExpiryWithoutRecovery,
  getSessionExpiryPhase,
  isSessionExpiryBlocking,
  notifyNavigationSettled,
  queueSessionExpiryWhileCsrf,
  requestSessionExpiry,
  retrySessionExpiryPersist,
  type SessionExpiryDialogModel,
} from '../lib/ux/sessionExpiryController';

const SessionExpiryBlockingContext = createContext(false);

export function useSessionExpiryBlocking(): boolean {
  return useContext(SessionExpiryBlockingContext);
}

export function SessionExpiryProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const authRoute = useAuthRoute();
  const session = useSession();
  const toast = useToast();
  const [blocking, setBlocking] = useState(false);
  const [dialog, setDialog] = useState<SessionExpiryDialogModel | null>(null);
  const hadEstablishedSession = useRef(false);
  const prevSessionData = useRef<unknown>(undefined);
  const authRouteRef = useRef(authRoute);
  const locationRef = useRef(location);

  useEffect(() => {
    authRouteRef.current = authRoute;
    locationRef.current = location;
  }, [authRoute, location]);

  useEffect(() => {
    if (session.data) hadEstablishedSession.current = true;
  }, [session.data]);

  const clearSessionState = useCallback(() => {
    setCsrfToken(null);
    queryClient.setQueryData(sessionKey, null);
  }, [queryClient]);

  const navigateToLogin = useCallback(
    async (nextPath: string) => {
      const next = safeNext(nextPath);
      await navigate(`/login?next=${encodeURIComponent(next)}`, { replace: true });
    },
    [navigate],
  );

  useLayoutEffect(() => {
    registerEstablishedSessionLifecycle({
      onConfirmedLogout: () => {
        hadEstablishedSession.current = false;
      },
    });

    configureSessionExpiryController({
      getHadEstablishedSession: () => hadEstablishedSession.current,
      getLogoutIntent,
      isAuthRoute: () => authRouteRef.current,
      isLoginRoute: () => locationRef.current.pathname === '/login',
      onPhaseChange: () => {
        setBlocking(isSessionExpiryBlocking());
      },
      onDialogChange: setDialog,
      clearSessionState,
      navigateToLogin,
    });

    setCacheErrorHandlers({
      getNextPath: () => {
        const loc = locationRef.current;
        return `${loc.pathname}${loc.search}${loc.hash}`;
      },
      getQueryClient: () => queryClient,
      onCsrfRefreshSucceeded: () => {
        toast({
          title: 'Session token refreshed',
          description: 'Please retry your action.',
          variant: 'success',
        });
      },
      onCsrfRefreshFailed: (message) => {
        toast({
          title: 'Could not refresh session',
          description: message,
          variant: 'error',
        });
      },
    });

    return () => {
      setCacheErrorHandlers(null);
    };
  }, [clearSessionState, navigateToLogin, queryClient, toast]);

  useEffect(() => {
    const prev = prevSessionData.current;
    const next = session.data;
    prevSessionData.current = next;
    if (prev && !next && !getLogoutIntent() && !authRoute) {
      const nextPath = `${location.pathname}${location.search}${location.hash}`;
      if (isCsrfRefreshInProgress()) {
        queueSessionExpiryWhileCsrf(nextPath);
      } else if (!isSessionExpiryBlocking()) {
        void requestSessionExpiry(nextPath);
      }
    }
  }, [authRoute, location.hash, location.pathname, location.search, session.data]);

  useEffect(() => {
    if (getSessionExpiryPhase() !== 'navigating') return;
    if (authRoute || location.pathname === '/login') {
      notifyNavigationSettled();
    }
  }, [authRoute, location.pathname]);

  const recoverableField = dialog?.recoverableDraft?.field ?? null;

  return (
    <SessionExpiryBlockingContext.Provider value={blocking}>
      {children}
      <UxSessionExpiredDialog
        open={dialog !== null}
        recoverableField={recoverableField}
        persistError={dialog?.persistError ?? null}
        navigationError={dialog?.navigationError ?? null}
        onContinue={confirmSessionExpiryContinue}
        onContinueWithoutRecovery={confirmSessionExpiryWithoutRecovery}
        onRetryPersist={retrySessionExpiryPersist}
      />
    </SessionExpiryBlockingContext.Provider>
  );
}
