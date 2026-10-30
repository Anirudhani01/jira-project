import { LayoutList, MoreHorizontal } from 'lucide-react';
import { Link } from 'react-router';

import { useBoardShell } from '../../app/shell/useBoardShell';
import { Button, IconButton } from '../../components/ui/Button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../components/ui/Overlay';
import { cn } from '../../lib/cn';
import { useSession } from '../auth/api';
import { useProject } from '../projects/api';

export function BoardPageHeader({
  org,
  projectKey,
  titleId,
  title,
  sprintName,
  boardType,
}: {
  org: string;
  projectKey: string;
  titleId: string;
  title: string;
  sprintName?: string | null;
  boardType: string;
}) {
  const boardChrome = useBoardShell();
  const session = useSession();
  const project = useProject(org, projectKey);

  if (!boardChrome) {
    return (
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <h1 id={titleId} className="text-2xl font-semibold text-fg">
            {title}
          </h1>
          {sprintName ? <p className="text-sm text-fg-muted">{sprintName}</p> : null}
        </div>
        <Link
          className="text-sm font-medium text-accent hover:underline"
          to={`/o/${org}/p/${projectKey}/issues`}
        >
          List view
        </Link>
      </div>
    );
  }

  const orgRecord = session.data?.orgs.find((o) => o.slug.toLowerCase() === org.toLowerCase());
  const orgName = orgRecord?.name ?? org;
  const projectName = project.data?.name ?? projectKey;

  return (
    <header className="board-page-header space-y-2">
      <nav aria-label="Breadcrumb" className="board-page-breadcrumb text-sm">
        <ol className="flex flex-wrap items-center gap-1.5">
          <li>
            <Link to={`/o/${org}`}>{orgName}</Link>
          </li>
          <li aria-hidden="true" className="text-[var(--board-muted)]">
            /
          </li>
          <li>
            <Link to={`/o/${org}/p/${projectKey}`}>{projectName}</Link>
          </li>
          <li aria-hidden="true" className="text-[var(--board-muted)]">
            /
          </li>
          <li aria-current="page">Board</li>
        </ol>
      </nav>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-baseline gap-3">
          <h1 id={titleId} className="board-page-title text-2xl font-semibold tracking-tight">
            {title}
          </h1>
          {sprintName ? (
            <p className="text-base font-normal text-[var(--board-muted)]">{sprintName}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            asChild
            variant="secondary"
            size="sm"
            className="board-btn-secondary gap-1.5 rounded-lg"
          >
            <Link to={`/o/${org}/p/${projectKey}/issues`}>
              <LayoutList className="size-4" aria-hidden="true" />
              List view
            </Link>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton
                label="Board actions"
                size="sm"
                className={cn('board-btn-secondary rounded-lg')}
              >
                <MoreHorizontal className="size-4" aria-hidden="true" />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link to={`/o/${org}/p/${projectKey}/issues`}>Issues</Link>
              </DropdownMenuItem>
              {boardType === 'scrum' ? (
                <DropdownMenuItem asChild>
                  <Link to={`/o/${org}/p/${projectKey}/backlog`}>Backlog</Link>
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem asChild>
                <Link to={`/o/${org}/p/${projectKey}`}>Project settings</Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
