import { apiFetch } from '../../../../lib/api/client';
import type { ProjectMember } from '../../../../lib/api/types';

/** Member count for one project. Issue and done counts come with the project list itself. */
export async function fetchProjectMemberCount(org: string, key: string): Promise<number> {
  const members = await apiFetch<{ items: ProjectMember[] }>(
    `/orgs/${encodeURIComponent(org)}/projects/${encodeURIComponent(key)}/members`,
  );
  return members.items.length;
}
