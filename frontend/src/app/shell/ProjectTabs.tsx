import { MoreHorizontal, Settings, Star } from 'lucide-react';
import { Link, NavLink } from 'react-router';

import { Avatar } from '../../components/ui/Avatar';
import { IconButton } from '../../components/ui/Button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../components/ui/Overlay';
import { useProject } from '../../features/projects/api';
import { cn } from '../../lib/cn';

import { useStarred } from './navPrefs';
import { useProjectContext } from './useProjectContext';

function tabClass({ isActive }: { isActive: boolean }) {
  return cn(
    '-mb-px border-b-2 px-3 py-2 text-sm font-medium no-underline outline-none',
    'focus-visible:ring-2 focus-visible:ring-accent',
    isActive
      ? 'border-accent text-accent'
      : 'border-transparent text-fg-muted hover:border-line-strong hover:text-fg',
  );
}

/** Project header and horizontal tabs under the top bar (Board, Backlog, List); settings and
 * other actions live in "More actions", as in the reference navigation. */
export function ProjectTabs() {
  const ctx = useProjectContext();
  const org = ctx?.org ?? '';
  const projectKey = ctx?.projectKey ?? '';
  const project = useProject(org, projectKey);
  const { isStarred, toggle } = useStarred(org);
  if (!ctx?.projectKey) return null;
  const base = `/o/${org}/p/${projectKey}`;
  const name = project.data?.name ?? projectKey;
  const starred = isStarred(projectKey);

  return (
    <div className="border-b border-line bg-surface px-4 pt-3 sm:px-6 lg:px-8">
      <p className="text-xs text-fg-muted">
        <Link to={`/o/${org}`} className="underline underline-offset-2">
          Projects
        </Link>{' '}
        / {name}
      </p>
      <div className="mt-1 flex items-center gap-2">
        <Avatar name={name} size="md" className="rounded-md" />
        <h1 className="truncate text-xl font-semibold">{name}</h1>
        <span className="font-mono text-xs text-fg-muted">{projectKey}</span>
        <IconButton
          label={starred ? `Unstar ${name}` : `Star ${name}`}
          size="sm"
          aria-pressed={starred}
          onClick={() => {
            toggle({ key: projectKey, name });
          }}
        >
          <Star
            className={cn('size-4', starred && 'fill-current text-warning')}
            aria-hidden="true"
          />
        </IconButton>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton label="More actions" size="sm">
              <MoreHorizontal className="size-4" aria-hidden="true" />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem asChild>
              <Link to={base} className="no-underline">
                <Settings className="size-4" aria-hidden="true" /> Project settings
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <nav aria-label="Project" className="mt-2 flex gap-1 overflow-x-auto">
        {project.data?.board_type === 'scrum' ? (
          <NavLink to={`${base}/backlog`} className={tabClass}>
            Backlog
          </NavLink>
        ) : null}
        <NavLink to={`${base}/board`} className={tabClass}>
          Board
        </NavLink>
        <NavLink to={`${base}/issues`} className={tabClass}>
          List
        </NavLink>
      </nav>
    </div>
  );
}
