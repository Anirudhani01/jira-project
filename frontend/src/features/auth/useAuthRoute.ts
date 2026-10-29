import { useLocation } from 'react-router';

const AUTH_PATHS = new Set([
  '/login',
  '/signup',
  '/verify-email',
  '/forgot-password',
  '/reset-password',
]);

export function useAuthRoute(): boolean {
  const { pathname } = useLocation();
  return AUTH_PATHS.has(pathname);
}
