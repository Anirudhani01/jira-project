import { ChevronsUpDown } from 'lucide-react';
import { Link, useNavigate } from 'react-router';

import { Avatar } from '../../components/ui/Avatar';
import { Button } from '../../components/ui/Button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../components/ui/Overlay';
import { useProjects } from '../../features/projects/api';

import { useProjectContext } from './useProjectContext';

/** Lists projects in the current org (`GET /orgs/{org}/projects`). */
export function ProjectSwitcher() {
  const ctx = useProjectContext();
  const navigate = useNavigate();
  const org = ctx?.org ?? '';
  const projects = useProjects(org);
  if (!ctx?.org) return null;
  const items = projects.data ?? [];
  const currentKey = ctx.projectKey?.toUpperCase();
  const current = items.find((p) => p.key.toUpperCase() === currentKey);

  const triggerLabel = current ? `${current.key} — ${current.name}` : 'Projects';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="hidden max-w-[14rem] justify-between gap-1 px-2 sm:inline-flex"
          disabled={projects.isPending}
        >
          {current ? <Avatar name={current.name} size="xs" className="shrink-0" /> : null}
          <span className="truncate">{triggerLabel}</span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-60" aria-hidden="true" />
          <span className="sr-only">Switch project</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 w-64 overflow-y-auto">
        <DropdownMenuLabel>Projects</DropdownMenuLabel>
        {items.map((project) => (
          <DropdownMenuItem
            key={project.key}
            onSelect={() => {
              void navigate(`/o/${ctx.org}/p/${project.key}/board`);
            }}
          >
            <span className="font-mono text-xs text-fg-muted">{project.key}</span>
            <span className="truncate">{project.name}</span>
            {currentKey === project.key.toUpperCase() ? ' ✓' : ''}
          </DropdownMenuItem>
        ))}
        {projects.isSuccess && items.length === 0 ? (
          <DropdownMenuItem disabled>No projects yet</DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to={`/o/${ctx.org}/projects/new`}>Create project…</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
