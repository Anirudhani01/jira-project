import { Search } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useMatch, useNavigate, useSearchParams } from 'react-router';

import { cn } from '../../lib/cn';
import { filterOrgProjects } from '../../features/orgs/dashboard/filterOrgProjects';
import { useProjects } from '../../features/projects/api';

import { useProjectContext } from './useProjectContext';

/** Top-bar search; syncs board `?q=` on the board route and org-home project filters. */
export function GlobalSearchBar({
  className,
  orgDashboard = false,
  boardChrome = false,
}: {
  className?: string;
  orgDashboard?: boolean;
  boardChrome?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const id = useId();
  const listId = `${id}-results`;
  const navigate = useNavigate();
  const ctx = useProjectContext();
  const onOrgHome = useMatch({ path: '/o/:org', end: true }) !== null;
  const onBoard = useMatch({ path: '/o/:org/p/:projectKey/board', end: true }) !== null;
  const orgOnly = useMatch('/o/:org/*');
  const inProject = useMatch('/o/:org/p/:projectKey/*');
  const orgSlug = orgOnly?.params.org && !inProject ? orgOnly.params.org : null;
  const [params, setParams] = useSearchParams();
  const [localQuery, setLocalQuery] = useState('');
  const [expanded, setExpanded] = useState(false);
  const projects = useProjects(orgSlug ?? ctx?.org ?? '', {
    enabled: Boolean(orgSlug ?? (boardChrome && ctx?.org)),
  });

  const value = onOrgHome || onBoard ? (params.get('q') ?? '') : localQuery;

  const matches = useMemo(() => {
    if (!value.trim()) return [];
    if (onBoard || orgSlug) {
      return filterOrgProjects(projects.data ?? [], value);
    }
    return [];
  }, [projects.data, value, onBoard, orgSlug]);

  const showProjectResults =
    expanded && value.trim().length > 0 && matches.length > 0 && (Boolean(orgSlug) || onBoard);

  const label = boardChrome ? 'Search issues and projects' : 'Search projects, issues, or people';

  const placeholder = boardChrome ? 'Search…' : 'Search projects, issues, or people...';

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  const goToOrgHomeSearch = (query: string) => {
    if (!orgSlug) return;
    const sp = new URLSearchParams();
    if (query.trim()) sp.set('q', query.trim());
    const qs = sp.toString();
    void navigate(qs ? `/o/${orgSlug}?${qs}` : `/o/${orgSlug}`);
  };

  const goToIssueListSearch = (query: string) => {
    if (!ctx?.org || !ctx.projectKey) return;
    const sp = new URLSearchParams();
    if (query.trim()) sp.set('q', query.trim());
    const qs = sp.toString();
    void navigate(
      qs
        ? `/o/${ctx.org}/p/${ctx.projectKey}/issues?${qs}`
        : `/o/${ctx.org}/p/${ctx.projectKey}/issues`,
    );
  };

  return (
    <div className={cn('relative min-w-0 flex-1', className)}>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <Search
        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle"
        aria-hidden="true"
      />
      <input
        ref={inputRef}
        id={id}
        type="search"
        name="global-search"
        autoComplete="off"
        role="combobox"
        aria-expanded={showProjectResults}
        aria-controls={showProjectResults ? listId : undefined}
        aria-autocomplete="list"
        placeholder={placeholder}
        value={value}
        onFocus={() => {
          setExpanded(true);
        }}
        onBlur={(e) => {
          const next = e.relatedTarget;
          if (!next || !listRef.current?.contains(next)) {
            setExpanded(false);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            if (onBoard) {
              e.preventDefault();
              goToIssueListSearch(value);
              setExpanded(false);
              return;
            }
            if (orgSlug && !onOrgHome) {
              e.preventDefault();
              goToOrgHomeSearch(value);
              setExpanded(false);
            }
          }
          if (e.key === 'Escape') {
            setExpanded(false);
            inputRef.current?.blur();
          }
        }}
        onChange={(e) => {
          const next = e.target.value;
          if (onOrgHome || onBoard) {
            const sp = new URLSearchParams(params);
            if (next.trim()) sp.set('q', next);
            else sp.delete('q');
            setParams(sp, { replace: true });
          } else {
            setLocalQuery(next);
            setExpanded(true);
          }
        }}
        className={cn(
          'h-9 w-full rounded-lg border border-line bg-surface-2/80 pl-9 pr-16 text-sm text-fg outline-none',
          'placeholder:text-fg-subtle focus:border-line-strong focus:bg-surface focus:ring-2 focus:ring-accent/25',
          orgDashboard &&
            'org-dash-search border-[var(--org-dash-border)] bg-[var(--org-dash-surface)] focus:border-[var(--org-dash-accent)] focus:ring-[color-mix(in_srgb,var(--org-dash-accent)_25%,transparent)]',
          boardChrome && 'board-search max-sm:pr-3 focus:ring-0',
        )}
      />
      <kbd
        className={cn(
          'pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded border border-line bg-surface px-1.5 py-0.5 font-mono text-[10px] text-fg-subtle sm:inline',
          orgDashboard && 'org-dash-kbd border-[var(--org-dash-border)] bg-[var(--org-dash-bg)]',
          boardChrome && 'board-kbd',
        )}
      >
        ⌘ K
      </kbd>
      {showProjectResults ? (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          className={cn(
            'absolute left-0 right-0 top-[calc(100%+4px)] z-50 max-h-64 overflow-auto rounded-lg border py-1 shadow-lg',
            boardChrome
              ? 'border-[var(--board-border)] bg-[var(--board-surface)]'
              : 'border-[var(--org-dash-border)] bg-[var(--org-dash-surface)]',
          )}
        >
          {matches.map((project) => (
            <li key={project.key} role="option">
              <button
                type="button"
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-2 text-left text-sm',
                  boardChrome
                    ? 'text-[var(--board-text)] hover:bg-[var(--board-accent-soft)]'
                    : 'text-[var(--org-dash-text)] hover:bg-[var(--org-dash-accent-soft)]',
                )}
                onMouseDown={(e) => {
                  e.preventDefault();
                }}
                onClick={() => {
                  const org = ctx?.org ?? orgSlug ?? '';
                  void navigate(`/o/${org}/p/${project.key}/board`);
                  setExpanded(false);
                }}
              >
                <span
                  className={cn(
                    'font-mono text-xs',
                    boardChrome ? 'text-[var(--board-muted)]' : 'text-[var(--org-dash-muted)]',
                  )}
                >
                  {project.key}
                </span>
                <span className="truncate">{project.name}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
