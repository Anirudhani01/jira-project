import type { ProjectSummary } from '../../../lib/api/types';

/** Client-side project match for org global search (name or key). */
export function filterOrgProjects(
  projects: ProjectSummary[],
  query: string,
  limit = 8,
): ProjectSummary[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return projects
    .filter((p) => p.name.toLowerCase().includes(q) || p.key.toLowerCase().includes(q))
    .slice(0, limit);
}
