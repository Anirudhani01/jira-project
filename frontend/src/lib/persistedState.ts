import { useCallback, useMemo, useSyncExternalStore } from 'react';

/** JSON state backed by localStorage, shared by every component and kept in sync across
 * tabs. Storage failures (private mode, quota) degrade to in-memory defaults. */
function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: the preference lasts for this session only */
  }
}

const CHANGE_EVENT = 'jira-persisted-change';

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}

function readRaw(storageKey: string | null): string | null {
  if (!storageKey) return null;
  try {
    return localStorage.getItem(storageKey);
  } catch {
    return null;
  }
}

/** State backed by localStorage, shared by every component and kept in sync across tabs. */
export function usePersisted<T>(storageKey: string | null, fallback: T): [T, (next: T) => void] {
  const raw = useSyncExternalStore(
    subscribe,
    () => readRaw(storageKey),
    () => null,
  );
  const value = useMemo<T>(() => {
    if (raw === null) return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }, [raw, fallback]);
  const set = useCallback(
    (next: T) => {
      if (!storageKey) return;
      write(storageKey, next);
      window.dispatchEvent(new Event(CHANGE_EVENT));
    },
    [storageKey],
  );
  return [value, set];
}
