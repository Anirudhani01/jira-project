import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export type ThemePreference = 'light' | 'dark' | 'system';

interface ThemeValue {
  preference: ThemePreference;
  /** What is actually applied right now. */
  resolved: 'light' | 'dark';
  setPreference: (value: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeValue | null>(null);
const STORAGE_KEY = 'theme';
// Legacy pages still use fixed light colours until they are migrated to tokens (plan PRs 2-10),
// so dark mode is opt-in for now. PR 12 flips this default to 'system'.
const DEFAULT_PREFERENCE: ThemePreference = 'light';

function readPreference(): ThemePreference {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === 'light' || saved === 'dark' || saved === 'system' ? saved : DEFAULT_PREFERENCE;
  } catch {
    return DEFAULT_PREFERENCE;
  }
}

function systemPrefersDark(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
}

/** Light / dark / system, stored per browser; follows the OS while on "system". */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(readPreference);
  const [systemDark, setSystemDark] = useState(systemPrefersDark);

  useEffect(() => {
    if (typeof matchMedia !== 'function') return undefined;
    const query = matchMedia('(prefers-color-scheme: dark)');
    const onChange = (event: MediaQueryListEvent) => {
      setSystemDark(event.matches);
    };
    query.addEventListener('change', onChange);
    return () => {
      query.removeEventListener('change', onChange);
    };
  }, []);

  const resolved = preference === 'system' ? (systemDark ? 'dark' : 'light') : preference;

  useEffect(() => {
    document.documentElement.dataset.theme = resolved;
  }, [resolved]);

  const setPreference = useCallback((value: ThemePreference) => {
    setPreferenceState(value);
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch {
      /* storage unavailable: the choice lasts for this session only */
    }
  }, []);

  const value = useMemo(
    () => ({ preference, resolved, setPreference }),
    [preference, resolved, setPreference],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme must be used inside ThemeProvider');
  return value;
}
