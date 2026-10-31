import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { useLocation } from 'react-router';

import { useSession } from '../../features/auth/api';

/** Per-user, per-organization navigation preferences, kept in this browser only
 * (docs/ui-redesign/jira-reference-research.md §2.1: starred, recent, customised sidebar). */
export interface StarredProject {
  key: string;
  name: string;
}
export interface RecentItem {
  kind: 'project' | 'issue';
  key: string;
  name?: string;
  at: number;
}

export const SIDEBAR_ITEMS = ['for-you', 'recent', 'starred', 'projects', 'reports'] as const;
export type SidebarItem = (typeof SIDEBAR_ITEMS)[number];

const MAX_RECENT = 8;
const MAX_STARRED = 20;

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: the preference lasts for this session only */
  }
}

function useNavKey(org: string, name: string): string | null {
  const session = useSession();
  const userId = session.data?.user.id;
  return userId ? `jira.nav.${userId}.${org.toLowerCase()}.${name}` : null;
}

const CHANGE_EVENT = 'jira-nav-change';

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
function usePersisted<T>(storageKey: string | null, fallback: T): [T, (next: T) => void] {
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

const NO_STARRED: StarredProject[] = [];
const NO_RECENT: RecentItem[] = [];
const NO_HIDDEN: SidebarItem[] = [];

export function useStarred(org: string) {
  const [starred, setStarred] = usePersisted(useNavKey(org, 'starred'), NO_STARRED);
  const isStarred = useCallback((key: string) => starred.some((s) => s.key === key), [starred]);
  const toggle = useCallback(
    (project: StarredProject) => {
      setStarred(
        starred.some((s) => s.key === project.key)
          ? starred.filter((s) => s.key !== project.key)
          : [...starred, project].slice(-MAX_STARRED),
      );
    },
    [starred, setStarred],
  );
  return useMemo(() => ({ starred, isStarred, toggle }), [starred, isStarred, toggle]);
}

export function useRecents(org: string) {
  const [recent, setRecent] = usePersisted(useNavKey(org, 'recent'), NO_RECENT);
  const record = useCallback(
    (item: Omit<RecentItem, 'at'>) => {
      const without = recent.filter((r) => !(r.kind === item.kind && r.key === item.key));
      const next = [{ ...item, at: Date.now() }, ...without].slice(0, MAX_RECENT);
      if (next[0]?.key === recent[0]?.key && next[0]?.kind === recent[0]?.kind) return;
      setRecent(next);
    },
    [recent, setRecent],
  );
  return useMemo(() => ({ recent, record }), [recent, record]);
}

export function useHiddenSidebarItems(org: string) {
  const [hidden, setHidden] = usePersisted(useNavKey(org, 'hidden'), NO_HIDDEN);
  const toggle = useCallback(
    (item: SidebarItem) => {
      setHidden(hidden.includes(item) ? hidden.filter((h) => h !== item) : [...hidden, item]);
    },
    [hidden, setHidden],
  );
  return useMemo(() => ({ hidden, toggle }), [hidden, toggle]);
}

/** Records the project or issue the user is looking at so "Recent" can list it. */
export function useTrackRecents(org: string | null): void {
  const { pathname } = useLocation();
  const { record } = useRecents(org ?? '');
  useEffect(() => {
    if (!org) return;
    const issue = /^\/o\/[^/]+\/issues\/([A-Za-z][A-Za-z0-9]*-\d+)/.exec(pathname);
    if (issue?.[1]) {
      record({ kind: 'issue', key: issue[1].toUpperCase() });
      return;
    }
    const project = /^\/o\/[^/]+\/p\/([A-Za-z][A-Za-z0-9]*)/.exec(pathname);
    if (project?.[1]) record({ kind: 'project', key: project[1].toUpperCase() });
  }, [org, pathname, record]);
}
