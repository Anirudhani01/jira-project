import { Command } from 'cmdk';
import {
  CornerDownLeft,
  FolderKanban,
  Home,
  Keyboard,
  LayoutList,
  ListTodo,
  Moon,
  Plus,
  Rows3,
  Sun,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';

import { Dialog, DialogContent } from '../../components/ui/Overlay';
import { TypeIcon } from '../../components/ui/IssueIcons';
import { useOrgIssueSearch } from '../../features/issues/api';
import { useProjects } from '../../features/projects/api';
import { useDebouncedValue } from '../../lib/useDebouncedValue';
import { useRecents } from '../shell/navPrefs';
import { useTheme } from '../../theme/ThemeProvider';

import { SHORTCUTS, keysLabel } from './shortcutDefs';

interface Action {
  id: string;
  label: string;
  icon: ReactNode;
  shortcut?: string | undefined;
  run: () => void;
}

const matches = (label: string, query: string) => {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const text = label.toLowerCase();
  return words.every((word) => text.includes(word));
};

const shortcutFor = (id: string) => {
  const found = SHORTCUTS.find((s) => s.id === id);
  return found ? keysLabel(found.keys) : undefined;
};

const ITEM =
  'flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm data-[selected=true]:bg-surface-hover';

/** Command palette (`Ctrl/Cmd+K`): actions, projects, recent items and issue search in one
 * box. Typing `/` first limits it to issues. Selecting an item runs it and closes the palette. */
export function CommandPalette({
  org,
  project,
  onClose,
  onCreateIssue,
  onOpenHelp,
}: {
  org: string | null;
  project: string | null;
  onClose: () => void;
  onCreateIssue: () => void;
  onOpenHelp: () => void;
}) {
  const navigate = useNavigate();
  const { resolved, setPreference } = useTheme();
  const [text, setText] = useState('');
  const issuesOnly = text.startsWith('/');
  const query = (issuesOnly ? text.slice(1) : text).trim();
  const projects = useProjects(org ?? '', { enabled: Boolean(org) });
  const issues = useOrgIssueSearch(org ?? '', useDebouncedValue(query, 250));
  const { recent } = useRecents(org ?? '');

  const go = (to: string) => () => {
    void navigate(to);
  };
  const base = org && project ? `/o/${org}/p/${project}` : null;
  const actions: Action[] = [
    ...(base
      ? [
          {
            id: 'create',
            label: 'Create issue',
            icon: <Plus className="size-4" aria-hidden="true" />,
            shortcut: shortcutFor('create'),
            run: onCreateIssue,
          },
          {
            id: 'board',
            label: 'Go to board',
            icon: <FolderKanban className="size-4" aria-hidden="true" />,
            shortcut: shortcutFor('go-board'),
            run: go(`${base}/board`),
          },
          {
            id: 'backlog',
            label: 'Go to backlog',
            icon: <Rows3 className="size-4" aria-hidden="true" />,
            shortcut: shortcutFor('go-backlog'),
            run: go(`${base}/backlog`),
          },
          {
            id: 'issues',
            label: 'Go to issue list',
            icon: <LayoutList className="size-4" aria-hidden="true" />,
            shortcut: shortcutFor('go-issues'),
            run: go(`${base}/issues`),
          },
        ]
      : []),
    ...(org
      ? [
          {
            id: 'home',
            label: 'Go to For you',
            icon: <Home className="size-4" aria-hidden="true" />,
            shortcut: shortcutFor('go-home'),
            run: go(`/o/${org}`),
          },
        ]
      : []),
    {
      id: 'theme',
      label: resolved === 'dark' ? 'Switch to light theme' : 'Switch to dark theme',
      icon:
        resolved === 'dark' ? (
          <Sun className="size-4" aria-hidden="true" />
        ) : (
          <Moon className="size-4" aria-hidden="true" />
        ),
      run: () => {
        setPreference(resolved === 'dark' ? 'light' : 'dark');
      },
    },
    {
      id: 'help',
      label: 'Show keyboard shortcuts',
      icon: <Keyboard className="size-4" aria-hidden="true" />,
      shortcut: shortcutFor('help'),
      run: onOpenHelp,
    },
  ];

  const shownActions = issuesOnly ? [] : actions.filter((a) => !query || matches(a.label, query));
  const shownProjects = issuesOnly
    ? []
    : (projects.data ?? [])
        .filter((p) => !p.archived && (!query || matches(`${p.key} ${p.name}`, query)))
        .slice(0, 6);
  const shownRecent =
    query || issuesOnly ? [] : recent.filter((r) => r.kind === 'issue').slice(0, 5);
  const found = issues.data ?? [];
  const nothing =
    shownActions.length + shownProjects.length + shownRecent.length + found.length === 0;

  const choose = (run: () => void) => () => {
    onClose();
    run();
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent title="Command palette" className="top-[12vh] w-[min(94vw,38rem)] p-3">
        <Command shouldFilter={false} label="Command palette" loop>
          <Command.Input
            value={text}
            onValueChange={setText}
            placeholder="Search actions, projects and issues… (type / for issues only)"
            className="mb-2 h-10 w-full rounded-md border border-line-strong bg-surface px-3 text-sm outline-none placeholder:text-fg-subtle"
          />
          <Command.List className="max-h-80 overflow-y-auto">
            {nothing ? (
              <Command.Empty className="px-2 py-6 text-center text-sm text-fg-muted">
                {issues.isFetching
                  ? 'Searching…'
                  : query
                    ? `Nothing matches “${query}”.`
                    : 'Nothing to show yet.'}
              </Command.Empty>
            ) : null}
            {shownActions.length > 0 ? (
              <Command.Group heading="Actions" className="px-1 py-1 text-xs text-fg-muted">
                {shownActions.map((action) => (
                  <Command.Item
                    key={action.id}
                    value={`action-${action.id}`}
                    onSelect={choose(action.run)}
                    className={ITEM}
                  >
                    {action.icon}
                    <span className="flex-1 text-sm text-fg">{action.label}</span>
                    {action.shortcut ? (
                      <kbd className="rounded border border-line-strong bg-surface-2 px-1.5 font-mono text-xs text-fg-muted">
                        {action.shortcut}
                      </kbd>
                    ) : null}
                  </Command.Item>
                ))}
              </Command.Group>
            ) : null}
            {shownProjects.length > 0 ? (
              <Command.Group heading="Projects" className="px-1 py-1 text-xs text-fg-muted">
                {shownProjects.map((p) => (
                  <Command.Item
                    key={p.key}
                    value={`project-${p.key}`}
                    onSelect={choose(go(`/o/${org ?? ''}/p/${p.key}/board`))}
                    className={ITEM}
                  >
                    <ListTodo className="size-4" aria-hidden="true" />
                    <span className="flex-1 text-sm text-fg">
                      {p.name} <span className="font-mono text-xs text-fg-muted">{p.key}</span>
                    </span>
                  </Command.Item>
                ))}
              </Command.Group>
            ) : null}
            {shownRecent.length > 0 ? (
              <Command.Group heading="Recent" className="px-1 py-1 text-xs text-fg-muted">
                {shownRecent.map((r) => (
                  <Command.Item
                    key={r.key}
                    value={`recent-${r.key}`}
                    onSelect={choose(go(`/o/${org ?? ''}/issues/${r.key}`))}
                    className={ITEM}
                  >
                    <span className="font-mono text-sm text-fg">{r.key}</span>
                  </Command.Item>
                ))}
              </Command.Group>
            ) : null}
            {found.length > 0 ? (
              <Command.Group heading="Issues" className="px-1 py-1 text-xs text-fg-muted">
                {found.map((issue) => (
                  <Command.Item
                    key={issue.id}
                    value={`issue-${issue.key}`}
                    onSelect={choose(go(`/o/${org ?? ''}/issues/${issue.key}`))}
                    className={ITEM}
                  >
                    <TypeIcon kind={issue.type.kind} name={issue.type.name} />
                    <span className="font-mono text-xs text-fg-muted">{issue.key}</span>
                    <span className="min-w-0 flex-1 truncate text-sm text-fg">{issue.summary}</span>
                    <CornerDownLeft className="size-3.5 text-fg-subtle" aria-hidden="true" />
                  </Command.Item>
                ))}
              </Command.Group>
            ) : null}
          </Command.List>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
