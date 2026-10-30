import { apiFetch } from '../../../../lib/api/client';
import type { Board, ProjectMember } from '../../../../lib/api/types';

const projectBase = (org: string, key: string) =>
  `/orgs/${encodeURIComponent(org)}/projects/${encodeURIComponent(key)}`;

export function sumBoardIssueCount(board: Board): number {
  return board.columns.reduce((sum, column) => sum + column.count, 0);
}

/** Real issue + member counts for one project (board columns + members list). */
export async function fetchProjectSecondaryStats(
  org: string,
  key: string,
): Promise<{ issueCount: number; memberCount: number }> {
  const [board, members] = await Promise.all([
    apiFetch<Board>(`${projectBase(org, key)}/board`),
    apiFetch<{ items: ProjectMember[] }>(`${projectBase(org, key)}/members`),
  ]);
  return {
    issueCount: sumBoardIssueCount(board),
    memberCount: members.items.length,
  };
}
