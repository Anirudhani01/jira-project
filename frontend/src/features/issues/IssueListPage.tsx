import { Search, X } from 'lucide-react';
import { useState } from 'react';
import { useParams, useSearchParams } from 'react-router';

import { NotFoundPage } from '../../app/pages/NotFoundPage';
import { Button } from '../../components/ui/Button';
import { EmptyState, Skeleton } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { PageHeader } from '../../components/ui/PageHeader';
import { ErrorState } from '../../components/ui/States';
import { ApiError } from '../../lib/api/errors';
import { useProject, useProjectMembers } from '../projects/api';

import { useIssues, useIssueTypes, usePriorities } from './api';
import { CreateIssueDialog } from './CreateIssueDialog';
import { IssueListColumnPicker } from './IssueListColumnPicker';
import { useIssueListColumns } from './issueListColumns';
import { IssueListTable } from './IssueListTable';

const FILTERS = ['status_category', 'type', 'priority', 'assignee', 'q'] as const;

const selectClass =
  'min-w-[7rem] rounded-md border border-line bg-surface px-3 py-2 text-sm text-fg hover:border-line-strong';

function filtersActive(search: URLSearchParams): boolean {
  return FILTERS.some((name) => Boolean(search.get(name)));
}

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
  const filters = Object.fromEntries(FILTERS.map((name) => [name, search.get(name) ?? undefined]));
  const issues = useIssues(org, { project: key.toUpperCase(), ...filters });
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
    const next = new URLSearchParams(search);
    for (const name of FILTERS) next.delete(name);
    setSearch(next);
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
  const hasFilters = filtersActive(search);

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
          {hasFilters ? (
            <Button type="button" variant="ghost" size="sm" onClick={clearFilters}>
              <X className="size-4" aria-hidden="true" />
              Clear
            </Button>
          ) : null}
        </div>
      </div>

      {issues.isPending ? <IssueListSkeleton /> : null}
      {issues.isError ? <ErrorState error={issues.error} /> : null}

      {issues.isSuccess && items.length === 0 ? (
        <EmptyState
          title="No issues match these filters"
          description="Try clearing filters or create a new issue."
          {...(canCreate
            ? {
                action: {
                  label: 'Create issue',
                  onClick: () => {
                    setCreating(true);
                  },
                },
              }
            : hasFilters
              ? { action: { label: 'Clear filters', onClick: clearFilters } }
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

          <IssueListTable
            org={org}
            items={items}
            columns={columns}
            types={types.data ?? []}
            priorities={priorities.data ?? []}
            members={members.data ?? []}
            canEdit={canEdit}
            canAssign={canAssign}
            canTransition={canTransition}
          />

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
