import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { useNavigate } from 'react-router';

import { useToast } from '../../components/ui/Toast';
import { CreateIssueDialog } from '../../features/issues/CreateIssueDialog';
import {
  areShortcutsEnabled,
  isTypingTarget,
  setShortcutsEnabled,
  shouldIgnoreShortcut,
} from '../../lib/keyboard';
import { usePersisted } from '../../lib/persistedState';
import { useRecents } from '../shell/navPrefs';
import { useOrgSlug } from '../shell/useOrgShell';
import { useProjectContext } from '../shell/useProjectContext';

import { CommandPalette } from './CommandPalette';
import { ShortcutsHelpDialog } from './ShortcutsHelpDialog';

interface ShortcutsValue {
  openCreateIssue: () => void;
  openPalette: () => void;
  openHelp: () => void;
  enabled: boolean;
  setEnabled: (value: boolean) => void;
}

const ShortcutsContext = createContext<ShortcutsValue | null>(null);
const ENABLED_KEY = 'jira.shortcuts.enabled';
const SEQUENCE_MS = 1500;

function focusRow(delta: 1 | -1, cursor: RefObject<string | null>): void {
  const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-issue-row]'));
  if (rows.length === 0) return;
  const current = rows.findIndex((row) => row.dataset.issueKey === cursor.current);
  const next =
    current < 0
      ? delta > 0
        ? 0
        : rows.length - 1
      : Math.min(rows.length - 1, Math.max(0, current + delta));
  const row = rows[next];
  if (!row) return;
  cursor.current = row.dataset.issueKey ?? null;
  // Focusing the row's own link makes screen readers announce it and gives a visible ring.
  row.querySelector<HTMLElement>('a[href*="/issues/"]')?.focus();
  row.scrollIntoView({ block: 'nearest' });
}

/** Global keyboard shortcuts, the command palette, the shortcut help dialog and the
 * create-issue dialog they open. Single keys are ignored while typing, when a modal is open
 * or when the user turned shortcuts off; `Ctrl/Cmd+K` still opens the palette. */
export function ShortcutsProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const toast = useToast();
  const org = useOrgSlug();
  const context = useProjectContext();
  const { recent } = useRecents(org ?? '');
  const [enabled, setEnabledState] = usePersisted<boolean>(ENABLED_KEY, true);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [awaitingGo, setAwaitingGo] = useState(false);
  const goTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cursor = useRef<string | null>(null);

  useEffect(() => {
    setShortcutsEnabled(enabled);
  }, [enabled]);

  const project = context?.projectKey ?? recent.find((r) => r.kind === 'project')?.key ?? null;
  const base = org && project ? `/o/${org}/p/${project}` : null;

  const openCreateIssue = useCallback(() => {
    if (!org || !project) {
      toast({
        title: 'Open a project first',
        description: 'Issues are created inside a project.',
        variant: 'error',
      });
      return;
    }
    setCreating(true);
  }, [org, project, toast]);

  const stopGo = useCallback(() => {
    if (goTimer.current) clearTimeout(goTimer.current);
    goTimer.current = null;
    setAwaitingGo(false);
  }, []);

  useEffect(() => {
    const go = (key: string) => {
      const target =
        key === 'h' && org
          ? `/o/${org}`
          : key === 'b' && base
            ? `${base}/board`
            : key === 'l' && base
              ? `${base}/backlog`
              : key === 'i' && base
                ? `${base}/issues`
                : null;
      if (target) void navigate(target);
    };
    const onKey = (event: KeyboardEvent) => {
      const pressed = event.key;
      if ((event.ctrlKey || event.metaKey) && pressed.toLowerCase() === 'k') {
        if (isTypingTarget(event) && !paletteOpen) return; // not while typing in a field
        event.preventDefault();
        setPaletteOpen((open) => !open);
        return;
      }
      if (shouldIgnoreShortcut(event)) {
        if (awaitingGo) stopGo();
        return;
      }
      if (awaitingGo) {
        stopGo();
        go(pressed.toLowerCase());
        event.preventDefault();
        return;
      }
      switch (pressed) {
        case '?':
          event.preventDefault();
          setHelpOpen(true);
          break;
        case 'c':
          event.preventDefault();
          openCreateIssue();
          break;
        case '/': {
          const search = document.querySelector<HTMLElement>('[data-global-search]');
          if (search) {
            event.preventDefault();
            search.focus();
          }
          break;
        }
        case 'g':
          setAwaitingGo(true);
          goTimer.current = setTimeout(stopGo, SEQUENCE_MS);
          break;
        case 'j':
          focusRow(1, cursor);
          break;
        case 'k':
          focusRow(-1, cursor);
          break;
        case 'o':
          document
            .querySelector<HTMLElement>('[data-issue-row] a[href*="/issues/"]:focus')
            ?.click();
          break;
        case 'm': {
          const composer = document.querySelector<HTMLElement>('[data-shortcut-target="comment"]');
          if (composer) {
            event.preventDefault();
            composer.focus();
          }
          break;
        }
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [awaitingGo, base, navigate, openCreateIssue, org, paletteOpen, stopGo]);

  const setEnabled = useCallback(
    (value: boolean) => {
      setEnabledState(value);
      setShortcutsEnabled(value);
    },
    [setEnabledState],
  );

  const value = useMemo<ShortcutsValue>(
    () => ({
      openCreateIssue,
      openPalette: () => {
        setPaletteOpen(true);
      },
      openHelp: () => {
        setHelpOpen(true);
      },
      enabled: enabled && areShortcutsEnabled(),
      setEnabled,
    }),
    [enabled, openCreateIssue, setEnabled],
  );

  return (
    <ShortcutsContext.Provider value={value}>
      {children}
      {awaitingGo ? (
        <p
          role="status"
          className="fixed bottom-4 left-4 z-50 rounded-md bg-fg px-3 py-1.5 text-sm text-bg shadow-lg"
        >
          Go to: H for you, B board, L backlog, I issues
        </p>
      ) : null}
      {paletteOpen ? (
        <CommandPalette
          org={org}
          project={project}
          onClose={() => {
            setPaletteOpen(false);
          }}
          onCreateIssue={openCreateIssue}
          onOpenHelp={() => {
            setHelpOpen(true);
          }}
        />
      ) : null}
      {helpOpen ? (
        <ShortcutsHelpDialog
          enabled={enabled}
          onEnabledChange={setEnabled}
          onClose={() => {
            setHelpOpen(false);
          }}
        />
      ) : null}
      {creating && org && project ? (
        <CreateIssueDialog
          org={org}
          project={project}
          onClose={() => {
            setCreating(false);
          }}
        />
      ) : null}
    </ShortcutsContext.Provider>
  );
}

export function useShortcuts(): ShortcutsValue {
  const value = useContext(ShortcutsContext);
  if (!value) throw new Error('useShortcuts must be used inside ShortcutsProvider');
  return value;
}
