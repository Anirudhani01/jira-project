import { useMembers } from '../../api';
import { useProjects } from '../../../projects/api';

/** Org-level counts for the dashboard header. Issue totals come with the project list. */
export function useOrgDashboardStats(org: string) {
  const projects = useProjects(org);
  const members = useMembers(org);

  const active = projects.isSuccess ? projects.data.filter((p) => !p.archived) : null;

  return {
    projectCount: active ? active.length : null,
    memberCount: members.isSuccess ? members.data.length : null,
    issueTotal: active ? active.reduce((sum, project) => sum + project.issue_count, 0) : null,
    projectsReady: projects.isSuccess,
    membersReady: members.isSuccess,
  };
}
