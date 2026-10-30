import type { ProjectSummary } from '../../../lib/api/types';

export type ProjectBoardFilter = 'all' | 'kanban' | 'scrum';
export type ProjectStatusFilter = 'active' | 'archived' | 'all';
export type ProjectSort = 'name-asc' | 'name-desc' | 'key-asc';
export type ProjectViewMode = 'grid' | 'list';

export interface ProjectDashboardFilters {
  q: string;
  boardType: ProjectBoardFilter;
  status: ProjectStatusFilter;
  sort: ProjectSort;
  view: ProjectViewMode;
}

export const DEFAULT_PROJECT_DASHBOARD_FILTERS: ProjectDashboardFilters = {
  q: '',
  boardType: 'all',
  status: 'active',
  sort: 'name-asc',
  view: 'grid',
};

export function parseProjectDashboardFilters(params: URLSearchParams): ProjectDashboardFilters {
  const boardType = params.get('type');
  const status = params.get('status');
  const sort = params.get('sort');
  const view = params.get('view');
  return {
    q: params.get('q') ?? '',
    boardType:
      boardType === 'kanban' || boardType === 'scrum' ? boardType : DEFAULT_PROJECT_DASHBOARD_FILTERS.boardType,
    status:
      status === 'archived' || status === 'all' ? status : DEFAULT_PROJECT_DASHBOARD_FILTERS.status,
    sort:
      sort === 'name-desc' || sort === 'key-asc' ? sort : DEFAULT_PROJECT_DASHBOARD_FILTERS.sort,
    view: view === 'list' ? 'list' : DEFAULT_PROJECT_DASHBOARD_FILTERS.view,
  };
}

export function applyProjectDashboardFilters(
  projects: ProjectSummary[],
  filters: ProjectDashboardFilters,
): ProjectSummary[] {
  const q = filters.q.trim().toLowerCase();
  let items = projects.filter((p) => {
    if (filters.status === 'active' && p.archived) return false;
    if (filters.status === 'archived' && !p.archived) return false;
    if (filters.boardType !== 'all' && p.board_type !== filters.boardType) return false;
    if (!q) return true;
    return (
      p.name.toLowerCase().includes(q) ||
      p.key.toLowerCase().includes(q) ||
      p.board_type.toLowerCase().includes(q)
    );
  });

  items = [...items].sort((a, b) => {
    switch (filters.sort) {
      case 'name-desc':
        return b.name.localeCompare(a.name);
      case 'key-asc':
        return a.key.localeCompare(b.key);
      case 'name-asc':
      default:
        return a.name.localeCompare(b.name);
    }
  });

  return items;
}
