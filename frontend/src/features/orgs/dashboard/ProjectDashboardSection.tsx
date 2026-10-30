import { useQueries } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';

import { EmptyState } from '../../../components/ui/Card';
import { ErrorState, ProjectGridSkeleton } from '../../../components/ui/States';
import { apiFetch } from '../../../lib/api/client';
import type { Project } from '../../../lib/api/types';
import { cn } from '../../../lib/cn';
import { projectKey, useProjects } from '../../projects/api';

import {
  applyProjectDashboardFilters,
  DEFAULT_PROJECT_DASHBOARD_FILTERS,
  parseProjectDashboardFilters,
  type ProjectDashboardFilters,
} from './projectDashboardFilters';
import { useProjectCardStats } from './hooks/useProjectCardStats';
import { CreateProjectDashboardCard, ProjectDashboardCard } from './ProjectDashboardCard';
import { ProjectDashboardToolbar } from './ProjectDashboardToolbar';

const projectPath = (org: string, key: string) =>
  `/orgs/${encodeURIComponent(org)}/projects/${encodeURIComponent(key)}`;

/** Loads descriptions after the project list resolves (secondary data). */
function useProjectDescriptions(org: string, keys: string[]) {
  const queries = useQueries({
    queries: keys.map((key) => ({
      queryKey: projectKey(org, key),
      queryFn: () => apiFetch<Project>(projectPath(org, key)),
      staleTime: 120_000,
      enabled: keys.length > 0,
    })),
  });

  return useMemo(() => {
    const map = new Map<string, string | null>();
    keys.forEach((key, index) => {
      const data = queries[index]?.data;
      if (data) map.set(key, data.description);
    });
    return map;
  }, [keys, queries]);
}

export function ProjectDashboardSection({ org, canCreate }: { org: string; canCreate: boolean }) {
  const [params, setParams] = useSearchParams();
  const filters = parseProjectDashboardFilters(params);
  const projects = useProjects(org);

  const setFilters = useCallback(
    (patch: Partial<ProjectDashboardFilters>) => {
      const next = { ...filters, ...patch };
      const sp = new URLSearchParams();
      if (next.q.trim()) sp.set('q', next.q.trim());
      if (next.boardType !== DEFAULT_PROJECT_DASHBOARD_FILTERS.boardType)
        sp.set('type', next.boardType);
      if (next.status !== DEFAULT_PROJECT_DASHBOARD_FILTERS.status) sp.set('status', next.status);
      if (next.sort !== DEFAULT_PROJECT_DASHBOARD_FILTERS.sort) sp.set('sort', next.sort);
      if (next.view !== DEFAULT_PROJECT_DASHBOARD_FILTERS.view) sp.set('view', next.view);
      setParams(sp, { replace: true });
    },
    [filters, setParams],
  );

  const allItems = projects.data ?? [];
  const filtered = applyProjectDashboardFilters(allItems, filters);
  const descriptionKeys = useMemo(() => filtered.map((p) => p.key), [filtered]);
  const descriptions = useProjectDescriptions(org, projects.isSuccess ? descriptionKeys : []);
  const cardStats = useProjectCardStats(org, descriptionKeys, projects.isSuccess);

  if (projects.isPending) return <ProjectGridSkeleton />;
  if (projects.isError) {
    return <ErrorState error={projects.error} onRetry={() => void projects.refetch()} />;
  }

  const showCreate = canCreate && filters.status !== 'archived';
  const empty = filtered.length === 0;

  return (
    <section aria-labelledby="org-projects-heading" className="space-y-4">
      <h2 id="org-projects-heading" className="sr-only">
        Projects
      </h2>
      <ProjectDashboardToolbar
        filters={filters}
        onChange={setFilters}
        resultCount={filtered.length}
      />
      {empty && !showCreate ? (
        <EmptyState
          title="No matching projects"
          description="Try adjusting your search or filters."
        />
      ) : (
        <div
          className={cn(
            filters.view === 'grid'
              ? 'grid gap-4 sm:grid-cols-2 xl:grid-cols-3'
              : 'flex flex-col gap-3',
          )}
        >
          {filtered.map((project) => {
            const stats = cardStats.data?.get(project.key);
            return (
              <ProjectDashboardCard
                key={project.key}
                org={org}
                project={project}
                description={descriptions.get(project.key) ?? null}
                {...(stats ? { stats } : {})}
                statsPending={cardStats.isPending || cardStats.isFetching}
                view={filters.view}
              />
            );
          })}
          {showCreate ? <CreateProjectDashboardCard org={org} /> : null}
        </div>
      )}
    </section>
  );
}
