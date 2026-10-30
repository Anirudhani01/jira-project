import { LayoutGrid, List, Search } from 'lucide-react';

import { IconButton } from '../../../components/ui/Button';
import { cn } from '../../../lib/cn';

import type {
  ProjectBoardFilter,
  ProjectDashboardFilters,
  ProjectSort,
  ProjectStatusFilter,
  ProjectViewMode,
} from './projectDashboardFilters';

const selectClass =
  'h-9 min-w-0 rounded-lg border border-[var(--org-dash-border)] bg-[var(--org-dash-surface)] px-2.5 text-sm text-[var(--org-dash-text)] outline-none focus:border-[var(--org-dash-accent)] focus:ring-2 focus:ring-[color-mix(in_srgb,var(--org-dash-accent)_20%,transparent)]';

export function ProjectDashboardToolbar({
  filters,
  onChange,
  resultCount,
}: {
  filters: ProjectDashboardFilters;
  onChange: (patch: Partial<ProjectDashboardFilters>) => void;
  resultCount: number;
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative min-w-0 flex-1 lg:max-w-sm">
          <label htmlFor="project-dashboard-search" className="sr-only">
            Search projects
          </label>
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--org-dash-muted)]"
            aria-hidden
          />
          <input
            id="project-dashboard-search"
            type="search"
            value={filters.q}
            onChange={(e) => {
              onChange({ q: e.target.value });
            }}
            placeholder="Search projects…"
            className={cn(selectClass, 'w-full pl-9')}
          />
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <label className="sr-only" htmlFor="project-type-filter">
            Project type
          </label>
          <select
            id="project-type-filter"
            className={selectClass}
            value={filters.boardType}
            onChange={(e) => {
              onChange({ boardType: e.target.value as ProjectBoardFilter });
            }}
          >
            <option value="all">All types</option>
            <option value="kanban">Kanban</option>
            <option value="scrum">Scrum</option>
          </select>
          <label className="sr-only" htmlFor="project-status-filter">
            Project status
          </label>
          <select
            id="project-status-filter"
            className={selectClass}
            value={filters.status}
            onChange={(e) => {
              onChange({ status: e.target.value as ProjectStatusFilter });
            }}
          >
            <option value="active">Active</option>
            <option value="archived">Archived</option>
            <option value="all">All statuses</option>
          </select>
          <label className="sr-only" htmlFor="project-sort">
            Sort projects
          </label>
          <select
            id="project-sort"
            className={selectClass}
            value={filters.sort}
            onChange={(e) => {
              onChange({ sort: e.target.value as ProjectSort });
            }}
          >
            <option value="name-asc">Name (A–Z)</option>
            <option value="name-desc">Name (Z–A)</option>
            <option value="key-asc">Project key</option>
          </select>
          <div className="flex rounded-lg border border-[var(--org-dash-border)] bg-[var(--org-dash-surface)] p-0.5">
            <IconButton
              label="Grid view"
              size="sm"
              className={cn(
                filters.view === 'grid' && 'org-dash-on-accent-soft bg-[var(--org-dash-accent-soft)]',
              )}
              aria-pressed={filters.view === 'grid'}
              onClick={() => {
                onChange({ view: 'grid' satisfies ProjectViewMode });
              }}
            >
              <LayoutGrid className="size-4" aria-hidden />
            </IconButton>
            <IconButton
              label="List view"
              size="sm"
              className={cn(
                filters.view === 'list' && 'org-dash-on-accent-soft bg-[var(--org-dash-accent-soft)]',
              )}
              aria-pressed={filters.view === 'list'}
              onClick={() => {
                onChange({ view: 'list' satisfies ProjectViewMode });
              }}
            >
              <List className="size-4" aria-hidden />
            </IconButton>
          </div>
        </div>
      </div>
      <p className="text-xs text-[var(--org-dash-muted)]" aria-live="polite">
        {resultCount === 1 ? '1 project' : `${resultCount} projects`}
      </p>
    </div>
  );
}
