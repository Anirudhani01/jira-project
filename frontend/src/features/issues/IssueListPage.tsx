import { Search, X } from 'lucide-react';
import { useState } from 'react';
import { useParams, useSearchParams } from 'react-router';

import { NotFoundPage } from '../../app/pages/NotFoundPage';
import { Button } from '../../components/ui/Button';
import { UxSearchEmpty } from '../../components/ux/UxSearchEmpty';
import { EmptyState, Skeleton } from '../../components/ui/Card';
import { suggestProjectQuery } from '../../lib/ux/searchSuggest';
import { Input } from '../../components/ui/Input';
import { PageHeader } from '../../components/ui/PageHeader';
import { ErrorState } from '../../components/ui/States';
import { ApiError } from '../../lib/api/errors';
import { useProject, useProjectMembers } from '../projects/api';

import { useIssues, useIssueTypes, useLabels, usePriorities, useProjectSprints } from './api';
import { CreateIssueDialog } from './CreateIssueDialog';
import { IssueListColumnPicker } from './IssueListColumnPicker';
import { useIssueListColumns } from './issueListColumns';
import {
  clearIssueListFiltersPreservingQuery,
  clearIssueListQuery,
  ISSUE_LIST_FILTER_KEYS,
  ISSUE_LIST_QUERY_KEY,
  issueListFiltersActive,
  issueListNonQueryFiltersActive,
  readIssueListSort,
} from './issueListSearchParams';
import { DEFAULT_ISSUE_LIST_SORT, type IssueListSort } from './issueListSort';
import { IssueListTable } from './IssueListTable';

const FILTERS = [...ISSUE_LIST_FILTER_KEYS, ISSUE_LIST_QUERY_KEY] as const;

const SORT_PARAM = 'sort';

const selectClass =
  'min-w-[7rem] rounded-md border border-line bg-surface px-3 py-2 text-sm text-fg hover:border-line-strong';

function IssueListSkeleton() {
  return (
    <div role="status" aria-label="Loading issues…" className="space-y-2">
      <span className="sr-only">Loading issues…</span>
      {[1, 2, 3, 4].map((i) => (
        <Skeleton key={i} className="h-14 w-full rounded-lg" />
      ))}
    </div>
  );
}

/** Project issue list: filters live in the URL; "Load more" follows the cursor. */
export function IssueListPage() {
  const { org = '', key = '' } = useParams();
  const [search, setSearch] = useSearchParams();
  const [creating, setCreating] = useState(false);
  const project = useProject(org, key);
  const members = useProjectMembers(org, key);
  const types = useIssueTypes(org);
  const priorities = usePriorities(org);
  const labels = useLabels(org, key);
  const sprints = useProjectSprints(org, key);
  const sort = readIssueListSort(search);
  const filters = Object.fromEntries(FILTERS.map((name) => [name, search.get(name) ?? undefined]));
  const issues = useIssues(org, { project: key.toUpperCase(), ...filters, sort });
  const {
    visible: columns,
    setColumn: setIssueListColumn,
    reset: resetColumns,
  } = useIssueListColumns(org, key);

  if (project.isPending) {
    return (
      <section aria-busy="true" className="w-full space-y-6">
        <Skeleton className="h-9 w-48" />
        <Skeleton className="h-28 w-full rounded-lg" />
        <IssueListSkeleton />
      </section>
    );
  }
  if (project.error instanceof ApiError && project.error.status === 404) return <NotFoundPage />;
  if (project.isError) return <ErrorState error={project.error} />;
  const writable = !project.data.archived;
  const canCreate = project.data.permissions.includes('issue.create') && writable;
  const canEdit = project.data.permissions.includes('issue.edit') && writable;
  const canAssign = project.data.permissions.includes('issue.assign') && writable;
  const canTransition = project.data.permissions.includes('issue.transition') && writable;

  const setFilter = (name: string, value: string) => {
    const next = new URLSearchParams(search);
    if (value) next.set(name, value);
    else next.delete(name);
    setSearch(next);
  };

  const clearFilters = () => {
    setSearch(clearIssueListFiltersPreservingQuery(search));
  };

  const clearSearch = () => {
    setSearch(clearIssueListQuery(search));
  };

  const setSort = (next: IssueListSort) => {
    const params = new URLSearchParams(search);
    if (next === DEFAULT_ISSUE_LIST_SORT) params.delete(SORT_PARAM);
    else params.set(SORT_PARAM, next);
    setSearch(params);
  };

  const select = (name: string, label: string, options: { value: string; label: string }[]) => (
    <label className="flex items-center gap-2 text-sm text-fg-muted">
      {label}
      <select
        className={selectClass}
        value={search.get(name) ?? ''}
        onChange={(e) => {
          setFilter(name, e.target.value);
        }}
      >
        <option value="">Any</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );

  const items = issues.data?.pages.flatMap((page) => page.items) ?? [];
  const hasFilters = issueListFiltersActive(search);
  const hasNonQueryFilters = issueListNonQueryFiltersActive(search);
  const searchQuery = search.get(ISSUE_LIST_QUERY_KEY) ?? '';
  const suggestion = searchQuery.trim()
    ? suggestProjectQuery(searchQuery, [{ key: project.data.key, name: project.data.name }])
    : null;

  return (
    <section aria-labelledby="issues-title" className="w-full space-y-6">
      <PageHeader
        titleId="issues-title"
        title={`${project.data.key} issues`}
        actions={
          canCreate ? (
            <Button
              type="button"
              variant="primary"
              onClick={() => {
                setCreating(true);
              }}
            >
              Create issue
            </Button>
          ) : null
        }
      />

      <div className="space-y-4 rounded-lg border border-line bg-surface p-4 sm:p-5">
        <form
          role="search"
          className="flex flex-wrap items-center gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            const value = new FormData(event.currentTarget).get('q');
            setFilter('q', typeof value === 'string' ? value.trim() : '');
          }}
        >
          <div className="relative min-w-[14rem] flex-1">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-fg-subtle"
              aria-hidden="true"
            />
            <Input
              key={search.get('q') ?? ''}
              name="q"
              type="search"
              aria-label="Search issues"
              maxLength={200}
              placeholder="Search by text or key (e.g. WEB-12)"
              defaultValue={search.get('q') ?? ''}
              className="pl-8"
            />
          </div>
          <Button type="submit" variant="secondary" size="sm">
            Search
          </Button>
        </form>

        <div
          className="flex flex-wrap items-center gap-x-5 gap-y-4 border-t border-line pt-5"
          role="group"
          aria-label="Filters"
        >
          {select('status_category', 'Status', [
            { value: 'todo', label: 'To do' },
            { value: 'in_progress', label: 'In progress' },
            { value: 'done', label: 'Done' },
          ])}
          {select(
            'type',
            'Type',
            (types.data ?? []).map((t) => ({ value: t.id, label: t.name })),
          )}
          {select(
            'priority',
            'Priority',
            (priorities.data ?? []).map((p) => ({ value: p.id, label: p.name })),
          )}
          {select('assignee', 'Assignee', [
            { value: 'me', label: 'Me' },
            { value: 'none', label: 'Unassigned' },
          ])}
          {select(
            'label',
            'Label',
            (labels.data ?? []).map((l) => ({ value: l.id, label: l.name })),
          )}
          {select('sprint', 'Sprint', [
            { value: 'backlog', label: 'Backlog only' },
            ...(sprints.data ?? []).map((s) => ({ value: s.id, label: s.name })),
          ])}
          {hasNonQueryFilters ? (
            <Button type="button" variant="ghost" size="sm" onClick={clearFilters}>
              <X className="size-4" aria-hidden="true" />
              Clear filters
            </Button>
          ) : null}
        </div>

        {hasFilters ? (
          <div
            className="flex flex-wrap gap-2 border-t border-line pt-4"
            aria-label="Active filters"
          >
            {sort !== DEFAULT_ISSUE_LIST_SORT ? (
              <FilterChip
                label={`Sort: ${sort}`}
                onRemove={() => {
                  setSort(DEFAULT_ISSUE_LIST_SORT);
                }}
              />
            ) : null}
            {FILTERS.map((name) => {
              const value = search.get(name);
              if (!value) return null;
              const display = filterChipLabel(name, value, {
                types: types.data ?? [],
                priorities: priorities.data ?? [],
                labels: labels.data ?? [],
                sprints: sprints.data ?? [],
              });
              return (
                <FilterChip
                  key={name}
                  label={display}
                  onRemove={() => {
                    setFilter(name, '');
                  }}
                />
              );
            })}
          </div>
        ) : null}
      </div>

      {issues.isPending ? <IssueListSkeleton /> : null}
      {issues.isError ? <ErrorState error={issues.error} /> : null}

      {issues.isSuccess && items.length === 0 && hasFilters ? (
        <UxSearchEmpty
          query={searchQuery}
          scope="issues"
          filtersActive={hasNonQueryFilters}
          onClearFilters={clearFilters}
          {...(searchQuery.trim() ? { onClearQuery: clearSearch } : {})}
          {...(suggestion
            ? {
                suggestion: {
                  label: suggestion.label,
                  onApply: () => {
                    setFilter(ISSUE_LIST_QUERY_KEY, suggestion.applyValue);
                  },
                },
              }
            : {})}
        />
      ) : null}

      {issues.isSuccess && items.length === 0 && !hasFilters ? (
        <EmptyState
          title="No issues yet"
          description="Create an issue to get started."
          {...(canCreate
            ? {
                action: {
                  label: 'Create issue',
                  onClick: () => {
                    setCreating(true);
                  },
                },
              }
            : {})}
        />
      ) : null}

      {items.length > 0 ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-fg-muted">
              {items.length}
              {issues.hasNextPage ? '+' : ''} issue{items.length === 1 ? '' : 's'}
            </p>
            <IssueListColumnPicker
              visible={columns}
              onSetColumn={setIssueListColumn}
              onReset={resetColumns}
            />
          </div>

          <div className="max-h-[min(70vh,48rem)] overflow-auto rounded-lg border border-line">
            <IssueListTable
              org={org}
              items={items}
              columns={columns}
              types={types.data ?? []}
              priorities={priorities.data ?? []}
              members={members.data ?? []}
              sort={sort}
              onSort={setSort}
              canEdit={canEdit}
              canAssign={canAssign}
              canTransition={canTransition}
            />
          </div>

          {issues.hasNextPage ? (
            <Button
              type="button"
              variant="secondary"
              disabled={issues.isFetchingNextPage}
              onClick={() => {
                void issues.fetchNextPage();
              }}
            >
              {issues.isFetchingNextPage ? 'Loading…' : 'Load more'}
            </Button>
          ) : null}
        </div>
      ) : null}

      {creating ? (
        <CreateIssueDialog
          org={org}
          project={project.data.key}
          onClose={() => {
            setCreating(false);
          }}
        />
      ) : null}
    </section>
  );
}

function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-line bg-surface-2 px-2.5 py-1 text-xs text-fg">
      {label}
      <button
        type="button"
        className="rounded p-0.5 text-fg-muted hover:bg-surface hover:text-fg"
        aria-label={`Remove ${label}`}
        onClick={onRemove}
      >
        <X className="size-3" aria-hidden="true" />
      </button>
    </span>
  );
}

function filterChipLabel(
  name: string,
  value: string,
  ctx: {
    types: { id: string; name: string }[];
    priorities: { id: string; name: string }[];
    labels: { id: string; name: string }[];
    sprints: { id: string; name: string }[];
  },
): string {
  switch (name) {
    case 'status_category':
      return `Status: ${value.replace('_', ' ')}`;
    case 'type':
      return `Type: ${ctx.types.find((t) => t.id === value)?.name ?? value}`;
    case 'priority':
      return `Priority: ${ctx.priorities.find((p) => p.id === value)?.name ?? value}`;
    case 'assignee':
      return value === 'me' ? 'Assignee: Me' : 'Assignee: Unassigned';
    case 'label':
      return `Label: ${ctx.labels.find((l) => l.id === value)?.name ?? value}`;
    case 'sprint':
      return value === 'backlog'
        ? 'Sprint: Backlog'
        : `Sprint: ${ctx.sprints.find((s) => s.id === value)?.name ?? value}`;
    case 'q':
      return `Search: ${value}`;
    default:
      return value;
  }
}
