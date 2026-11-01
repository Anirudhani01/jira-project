import { Kanban, LayoutList, ListTree } from 'lucide-react';
import { Link, useParams, useSearchParams } from 'react-router';

import { NotFoundPage } from '../../app/pages/NotFoundPage';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { FormError } from '../../components/ui/Form';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/Overlay';
import { ErrorState, LoadingState } from '../../components/ui/States';
import { useBoard } from '../board/api';
import { ApiError } from '../../lib/api/errors';
import { describeError } from '../../lib/forms';
import { permissionDeniedInlineMessage } from '../../lib/ux/permissionDenied';

import {
  useProject,
  useProjectMembers,
  useRemoveProjectMember,
  useSetArchived,
  useWorkflow,
} from './api';
import { BoardColumnsEditor } from './BoardColumnsEditor';
import { ProjectMembersSection } from './ProjectMembersSection';
import { ProjectWorkflowSection } from './ProjectWorkflowSection';

const TABS = ['details', 'members', 'columns', 'workflow', 'danger'] as const;
type Tab = (typeof TABS)[number];

/** Project settings as tabs: details, members, board columns, workflow, danger zone. */
export function ProjectPage() {
  const { org = '', key = '' } = useParams();
  const project = useProject(org, key);
  const workflow = useWorkflow(org, key);
  const members = useProjectMembers(org, key);
  const board = useBoard(org, key);
  const [search, setSearch] = useSearchParams();
  const requested = search.get('tab');
  const tab: Tab = TABS.find((t) => t === requested) ?? 'details';
  const archive = useSetArchived(org, key);
  const removeMember = useRemoveProjectMember(org, key);

  if (project.isPending) return <LoadingState label="Loading project" />;
  if (project.error instanceof ApiError && project.error.status === 404) return <NotFoundPage />;
  if (project.isError) return <ErrorState error={project.error} />;

  const p = project.data;
  const canManage = p.permissions.includes('project.manage');
  const canManageMembers = p.permissions.includes('project.members.manage');
  const failureRaw = archive.error ?? removeMember.error;
  const failure = failureRaw
    ? (permissionDeniedInlineMessage(failureRaw, 'project-settings') ?? describeError(failureRaw))
    : null;
  const base = `/o/${org}/p/${p.key}`;

  return (
    <section aria-labelledby="project-title" className="w-full space-y-6">
      <PageHeader
        titleId="project-title"
        title={`${p.key} — ${p.name}`}
        {...(p.description ? { description: p.description } : {})}
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

      <FormError>{failure}</FormError>

      <Tabs
        value={tab}
        onValueChange={(value) => {
          const next = new URLSearchParams(search);
          next.set('tab', value);
          setSearch(next, { replace: true });
        }}
      >
        <TabsList aria-label="Project settings" className="overflow-x-auto">
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="members">Members</TabsTrigger>
          <TabsTrigger value="columns">Board columns</TabsTrigger>
          <TabsTrigger value="workflow">Workflow</TabsTrigger>
          <TabsTrigger value="danger">Danger zone</TabsTrigger>
        </TabsList>

        <TabsContent value="details" className="pt-4">
          <Card className="space-y-2 p-5 sm:p-6">
            <h2 className="text-lg font-semibold text-fg">Details</h2>
            <dl className="grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
              <dt className="text-fg-muted">Key</dt>
              <dd className="text-fg">{p.key}</dd>
              <dt className="text-fg-muted">Name</dt>
              <dd className="text-fg">{p.name}</dd>
              <dt className="text-fg-muted">Board type</dt>
              <dd className="text-fg">{p.board_type === 'scrum' ? 'Scrum' : 'Kanban'}</dd>
              <dt className="text-fg-muted">Description</dt>
              <dd className="text-fg">{p.description ?? 'No description'}</dd>
            </dl>
          </Card>
        </TabsContent>

        <TabsContent value="members" className="pt-4">
          <ProjectMembersSection
            members={members}
            canManageMembers={canManageMembers}
            removing={removeMember.isPending}
            onRemove={(userId) => {
              removeMember.mutate(userId, { onSuccess: () => void members.refetch() });
            }}
          />
        </TabsContent>

        <TabsContent value="columns" className="pt-4">
          {board.isPending || workflow.isPending ? (
            <LoadingState label="Loading board columns" />
          ) : board.isError || workflow.isError ? (
            <ErrorState
              error={board.error ?? workflow.error}
              onRetry={() => {
                void board.refetch();
                void workflow.refetch();
              }}
            />
          ) : (
            <BoardColumnsEditor
              key={board.data.columns
                .map((c) => `${c.id}:${c.name}:${String(c.wip_limit)}`)
                .join('|')}
              org={org}
              project={p.key}
              board={board.data}
              workflow={workflow.data}
              canManage={p.permissions.includes('board.manage')}
            />
          )}
        </TabsContent>

        <TabsContent value="workflow" className="pt-4">
          <ProjectWorkflowSection workflow={workflow} project={{ key: p.key, name: p.name }} />
        </TabsContent>

        <TabsContent value="danger" className="pt-4">
          <Card className="space-y-3 border-danger/40 p-5 sm:p-6">
            <h2 className="text-lg font-semibold text-danger">Danger zone</h2>
            <p className="text-sm text-fg-muted">
              {p.archived
                ? 'This project is archived and read-only. Unarchive it to edit again.'
                : 'Archiving makes the project read-only. You can unarchive it later.'}
            </p>
            {canManage ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="text-danger"
                disabled={archive.isPending}
                onClick={() => {
                  archive.mutate(!p.archived, { onSuccess: () => void project.refetch() });
                }}
              >
                {p.archived ? 'Unarchive project' : 'Archive project'}
              </Button>
            ) : (
              <p className="text-sm text-fg-muted">You need permission to archive this project.</p>
            )}
          </Card>
        </TabsContent>
      </Tabs>
    </section>
  );
}
