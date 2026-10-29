import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';

import { NotFoundPage } from '../../app/pages/NotFoundPage';
import { ErrorState, LoadingState } from '../../components/ui/States';
import { ApiError } from '../../lib/api/errors';
import { useProject } from '../projects/api';

import { useIssues, useIssueTypes, usePriorities } from './api';
import { CreateIssueDialog } from './CreateIssueDialog';

const FILTERS = ['status_category', 'type', 'priority', 'assignee', 'q'] as const;

/** Project issue list: filters live in the URL; "Load more" follows the cursor. */
export function IssueListPage() {
  const { org = '', key = '' } = useParams();
  const [search, setSearch] = useSearchParams();
  const [creating, setCreating] = useState(false);
  const project = useProject(org, key);
  const types = useIssueTypes(org);
  const priorities = usePriorities(org);
  const filters = Object.fromEntries(FILTERS.map((name) => [name, search.get(name) ?? undefined]));
  const issues = useIssues(org, { project: key.toUpperCase(), ...filters });

  if (project.isPending) return <LoadingState label="Loading project" />;
  if (project.error instanceof ApiError && project.error.status === 404) return <NotFoundPage />;
  if (project.isError) return <ErrorState error={project.error} />;
  const canCreate = project.data.permissions.includes('issue.create') && !project.data.archived;

  const setFilter = (name: string, value: string) => {
    const next = new URLSearchParams(search);
    if (value) next.set(name, value);
    else next.delete(name);
    setSearch(next);
  };
  const select = (name: string, label: string, options: { value: string; label: string }[]) => (
    <label className="text-sm">
      {label}{' '}
      <select
        className="rounded border border-slate-300 px-2 py-1"
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

  return (
    <section aria-labelledby="issues-title" className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 id="issues-title" className="text-2xl font-semibold">
          {project.data.key} issues
        </h1>
        {canCreate ? (
          <button
            type="button"
            className="rounded bg-blue-700 px-4 py-2 font-medium text-white"
            onClick={() => {
              setCreating(true);
            }}
          >
            Create issue
          </button>
        ) : null}
      </div>
      <form
        role="search"
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const value = new FormData(event.currentTarget).get('q');
          setFilter('q', typeof value === 'string' ? value.trim() : '');
        }}
      >
        <label className="text-sm">
          <span className="sr-only">Search issues</span>
          <input
            key={search.get('q') ?? ''}
            name="q"
            type="search"
            maxLength={200}
            placeholder="Search by text or key (e.g. WEB-12)"
            defaultValue={search.get('q') ?? ''}
            className="w-72 rounded border border-slate-300 px-2 py-1"
          />
        </label>
        <button type="submit" className="rounded border border-slate-300 px-3 py-1 text-sm">
          Search
        </button>
      </form>
      <div className="flex flex-wrap gap-4" role="group" aria-label="Filters">
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
      </div>
      {issues.isPending ? <LoadingState label="Loading issues" /> : null}
      {issues.isError ? <ErrorState error={issues.error} /> : null}
      {issues.isSuccess && items.length === 0 ? (
        <p className="text-slate-600">No issues match these filters.</p>
      ) : null}
      <ul className="divide-y rounded border">
        {items.map((issue) => (
          <li key={issue.id} className="flex items-center gap-3 p-3 text-sm">
            <Link
              className="font-mono text-blue-700 underline"
              to={`/o/${org}/issues/${issue.key}`}
            >
              {issue.key}
            </Link>
            <span className="flex-1">{issue.summary}</span>
            <span>{issue.type.name}</span>
            <span>{issue.priority.name}</span>
            <span className="rounded bg-slate-100 px-2">{issue.status.name}</span>
          </li>
        ))}
      </ul>
      {issues.hasNextPage ? (
        <button
          type="button"
          className="text-blue-700 underline"
          disabled={issues.isFetchingNextPage}
          onClick={() => void issues.fetchNextPage()}
        >
          Load more
        </button>
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
