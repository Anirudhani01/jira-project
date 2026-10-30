import { Kanban, LayoutList, ListTree } from 'lucide-react';
import { Link, useParams } from 'react-router';

import { NotFoundPage } from '../../app/pages/NotFoundPage';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { FormError } from '../../components/ui/Form';
import { PageHeader } from '../../components/ui/PageHeader';
import { ErrorState, LoadingState } from '../../components/ui/States';
import { ApiError } from '../../lib/api/errors';
import { describeError } from '../../lib/forms';

import {
  useProject,
  useProjectMembers,
  useRemoveProjectMember,
  useSetArchived,
  useWorkflow,
} from './api';
import { ProjectMembersSection } from './ProjectMembersSection';
import { ProjectWorkflowSection } from './ProjectWorkflowSection';

/** Project settings: workflow, board columns, members, archive. */
export function ProjectPage() {
  const { org = '', key = '' } = useParams();
  const project = useProject(org, key);
  const workflow = useWorkflow(org, key);
  const members = useProjectMembers(org, key);
  const archive = useSetArchived(org, key);
  const removeMember = useRemoveProjectMember(org, key);

  if (project.isPending) return <LoadingState label="Loading project" />;
  if (project.error instanceof ApiError && project.error.status === 404) return <NotFoundPage />;
  if (project.isError) return <ErrorState error={project.error} />;

  const p = project.data;
  const canManage = p.permissions.includes('project.manage');
  const canManageMembers = p.permissions.includes('project.members.manage');
  const failure = archive.error ?? removeMember.error;
  const base = `/o/${org}/p/${p.key}`;

  return (
    <section aria-labelledby="project-title" className="w-full space-y-6">
      <PageHeader
        titleId="project-title"
        title={`${p.key} — ${p.name}`}
        {...(p.description ? { description: p.description } : {})}
        actions={
          canManage ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-danger hover:bg-danger/10 hover:text-danger"
              disabled={archive.isPending}
              onClick={() => {
                archive.mutate(!p.archived, { onSuccess: () => void project.refetch() });
              }}
            >
              {p.archived ? 'Unarchive project' : 'Archive project'}
            </Button>
          ) : null
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        {p.archived ? <Badge tone="warning">Archived</Badge> : null}
        <Badge tone="neutral">{p.board_type === 'scrum' ? 'Scrum' : 'Kanban'}</Badge>
      </div>

      <nav aria-label="Project views" className="flex flex-wrap gap-2">
        <Button asChild variant="secondary" size="sm">
          <Link to={`${base}/board`}>
            <Kanban className="size-4" aria-hidden="true" />
            Board
          </Link>
        </Button>
        {p.board_type === 'scrum' ? (
          <Button asChild variant="secondary" size="sm">
            <Link to={`${base}/backlog`}>
              <ListTree className="size-4" aria-hidden="true" />
              Backlog
            </Link>
          </Button>
        ) : null}
        <Button asChild variant="secondary" size="sm">
          <Link to={`${base}/issues`}>
            <LayoutList className="size-4" aria-hidden="true" />
            Issues
          </Link>
        </Button>
      </nav>

      <FormError>{failure ? describeError(failure) : null}</FormError>

      <ProjectWorkflowSection workflow={workflow} />
      <ProjectMembersSection
        members={members}
        canManageMembers={canManageMembers}
        removing={removeMember.isPending}
        onRemove={(userId) => {
          removeMember.mutate(userId, { onSuccess: () => void members.refetch() });
        }}
      />
    </section>
  );
}
