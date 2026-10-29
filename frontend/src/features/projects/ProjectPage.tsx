import { Link, useParams } from 'react-router';

import { NotFoundPage } from '../../app/pages/NotFoundPage';
import { FormError } from '../../components/ui/Form';
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

/** Project overview: read-only workflow, default board columns, members, archive. */
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
  const statusName = new Map((workflow.data?.statuses ?? []).map((s) => [s.id, s.name]));
  const failure = archive.error ?? removeMember.error;

  return (
    <section aria-labelledby="project-title" className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 id="project-title" className="text-2xl font-semibold">
          {p.key} — {p.name}
          {p.archived ? ' (archived)' : ''}
        </h1>
        {canManage ? (
          <button
            type="button"
            className="text-blue-700 underline"
            onClick={() => {
              archive.mutate(!p.archived, { onSuccess: () => void project.refetch() });
            }}
          >
            {p.archived ? 'Unarchive project' : 'Archive project'}
          </button>
        ) : null}
      </div>
      <div className="flex gap-4">
        <Link className="text-blue-700 underline" to={`/o/${org}/p/${p.key}/board`}>
          Board
        </Link>
        {p.board_type === 'scrum' ? (
          <Link className="text-blue-700 underline" to={`/o/${org}/p/${p.key}/backlog`}>
            Backlog
          </Link>
        ) : null}
        <Link className="text-blue-700 underline" to={`/o/${org}/p/${p.key}/issues`}>
          View issues
        </Link>
      </div>
      <FormError>{failure ? describeError(failure) : null}</FormError>
      <section aria-labelledby="workflow-title" className="space-y-2">
        <h2 id="workflow-title" className="text-lg font-semibold">
          Workflow
        </h2>
        <ol className="flex gap-3">
          {(workflow.data?.statuses ?? []).map((s) => (
            <li key={s.id} className="rounded bg-slate-100 px-2 py-1 text-sm">
              {s.name}
            </li>
          ))}
        </ol>
        <h3 className="font-medium">Board columns</h3>
        <ul className="text-sm">
          {(workflow.data?.columns ?? []).map((c) => (
            <li key={c.position}>
              {c.name}: {c.status_ids.map((id) => statusName.get(id)).join(', ')}
            </li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="project-members-title" className="space-y-2">
        <h2 id="project-members-title" className="text-lg font-semibold">
          Members
        </h2>
        <ul className="text-sm">
          {(members.data ?? []).map((m) => (
            <li key={m.user_id}>
              {m.display_name} ({m.role}){' '}
              {canManageMembers ? (
                <button
                  type="button"
                  className="text-red-700 underline"
                  onClick={() => {
                    removeMember.mutate(m.user_id, { onSuccess: () => void members.refetch() });
                  }}
                >
                  Remove {m.display_name} from project
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    </section>
  );
}
