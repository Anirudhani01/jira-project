import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

/**
 * Reads a single-use token from the URL fragment (`#token=...`, plan C4) once, then removes
 * it from the address bar and history so it is not left behind, bookmarked or shared.
 * While the page is mounted the document's referrer policy is `no-referrer`.
 */
export function useFragmentToken(): string | null {
  const location = useLocation();
  const navigate = useNavigate();
  const [token] = useState<string | null>(() => {
    const value = new URLSearchParams(location.hash.replace(/^#/, '')).get('token');
    return value && TOKEN_PATTERN.test(value) ? value : null;
  });

  useEffect(() => {
    if (location.hash) {
      void navigate({ pathname: location.pathname, search: location.search }, { replace: true });
    }
  }, [location.hash, location.pathname, location.search, navigate]);

  useEffect(() => {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="referrer"]');
    if (!meta) return undefined;
    const previous = meta.content;
    meta.content = 'no-referrer';
    return () => {
      meta.content = previous;
    };
  }, []);

  return token;
}
