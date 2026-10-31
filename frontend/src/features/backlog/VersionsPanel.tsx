import { useDroppable } from '@dnd-kit/core';
import { MoreHorizontal, Plus } from 'lucide-react';

import { Badge } from '../../components/ui/Badge';
import { Button, IconButton } from '../../components/ui/Button';
import { Skeleton } from '../../components/ui/Card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../components/ui/Overlay';
import { ErrorState } from '../../components/ui/States';
import { UxEmptyState } from '../../components/ux';
import { cn } from '../../lib/cn';
import type { Version } from '../../lib/api/types';

import { NONE } from './backlogState';
import { Progress } from './EpicsPanel';
import { useVersions } from './planApi';

export type VersionAction = 'edit' | 'release' | 'unrelease' | 'archive' | 'unarchive' | 'delete';

const dateFormat = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});
const formatDate = (iso: string | null) =>
  iso ? dateFormat.format(new Date(`${iso}T00:00:00Z`)) : '';

function Row({
  id,
  active,
  onSelect,
  children,
  menu,
}: {
  id: string;
  active: boolean;
  onSelect: () => void;
  children: React.ReactNode;
  menu?: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <li ref={setNodeRef} className="flex items-start gap-1">
      <button
        type="button"
        aria-pressed={active}
        onClick={onSelect}
        className={cn(
          'min-w-0 flex-1 rounded-md border px-2 py-1.5 text-left text-sm',
          active ? 'border-accent bg-accent-soft' : 'border-transparent hover:bg-surface-hover',
          isOver && 'ring-2 ring-accent',
        )}
      >
        {children}
      </button>
      {menu}
    </li>
  );
}

const TONE = { unreleased: 'neutral', released: 'success', archived: 'warning' } as const;

/** Backlog Versions panel: choose a version to filter the backlog, drop issues on it to set
 * their fix version, and release / archive / edit / delete versions. */
export function VersionsPanel({
  org,
  project,
  selected,
  onSelect,
  includeArchived,
  onIncludeArchived,
  canManage,
  online,
  onCreate,
  onAction,
}: {
  org: string;
  project: string;
  selected: string;
  onSelect: (value: string) => void;
  includeArchived: boolean;
  onIncludeArchived: (value: boolean) => void;
  canManage: boolean;
  online: boolean;
  onCreate: () => void;
  onAction: (action: VersionAction, version: Version) => void;
}) {
  const versions = useVersions(org, project, includeArchived);
  const toggle = (value: string) => {
    onSelect(selected === value ? '' : value);
  };
  return (
    <section aria-label="Versions" className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Versions</h2>
        {canManage ? (
          <Button variant="secondary" size="sm" disabled={!online} onClick={onCreate}>
            <Plus className="size-4" aria-hidden="true" /> Create version
          </Button>
        ) : null}
      </div>
      <label className="flex items-center gap-2 text-xs text-fg-muted">
        <input
          type="checkbox"
          checked={includeArchived}
          onChange={(event) => {
            onIncludeArchived(event.target.checked);
          }}
        />
        Show archived versions
      </label>
      {versions.isPending ? (
        <div role="status" aria-label="Loading versions…" className="space-y-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : versions.isError ? (
        <ErrorState error={versions.error} onRetry={() => void versions.refetch()} />
      ) : (
        <ul className="space-y-1">
          <Row
            id="version:all"
            active={selected === ''}
            onSelect={() => {
              onSelect('');
            }}
          >
            All issues
          </Row>
          <Row
            id={`version:${NONE}`}
            active={selected === NONE}
            onSelect={() => {
              toggle(NONE);
            }}
          >
            Issues without version
          </Row>
          {versions.data.map((version) => (
            <Row
              key={version.id}
              id={`version:${version.id}`}
              active={selected === version.id}
              onSelect={() => {
                toggle(version.id);
              }}
              menu={
                canManage ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <IconButton label={`Version actions for ${version.name}`} size="sm">
                        <MoreHorizontal className="size-4" aria-hidden="true" />
                      </IconButton>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      <DropdownMenuItem
                        onSelect={() => {
                          onAction('edit', version);
                        }}
                      >
                        Edit version
                      </DropdownMenuItem>
                      {version.status === 'unreleased' ? (
                        <DropdownMenuItem
                          disabled={!online}
                          onSelect={() => {
                            onAction('release', version);
                          }}
                        >
                          Release
                        </DropdownMenuItem>
                      ) : null}
                      {version.status === 'released' ? (
                        <DropdownMenuItem
                          disabled={!online}
                          onSelect={() => {
                            onAction('unrelease', version);
                          }}
                        >
                          Unrelease
                        </DropdownMenuItem>
                      ) : null}
                      {version.status === 'archived' ? (
                        <DropdownMenuItem
                          disabled={!online}
                          onSelect={() => {
                            onAction('unarchive', version);
                          }}
                        >
                          Unarchive
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem
                          disabled={!online}
                          onSelect={() => {
                            onAction('archive', version);
                          }}
                        >
                          Archive
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem
                        onSelect={() => {
                          onAction('delete', version);
                        }}
                      >
                        Delete version
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null
              }
            >
              <span className="flex items-center gap-1.5">
                <span className="truncate font-medium">{version.name}</span>
                <Badge tone={TONE[version.status as keyof typeof TONE]}>{version.status}</Badge>
              </span>
              <span className="mt-0.5 flex items-center justify-between text-xs text-fg-muted">
                <span className={cn(version.overdue && 'font-medium text-danger')}>
                  {version.release_date
                    ? `${version.overdue ? 'Overdue · ' : 'Release '}${formatDate(version.release_date)}`
                    : 'No release date'}
                </span>
                <span>
                  {version.done_count}/{version.issue_count} done
                </span>
              </span>
              <span className="mt-1 block">
                <Progress
                  done={version.done_count}
                  total={version.issue_count}
                  label={`${String(version.done_count)} of ${String(version.issue_count)} issues done in ${version.name}`}
                />
              </span>
            </Row>
          ))}
          {versions.data.length === 0 ? (
            <li>
              <UxEmptyState
                reason="no_data"
                title="No versions yet"
                description={
                  canManage
                    ? 'Create a version, then drag issues onto it to plan a release.'
                    : 'A project admin can create versions to plan releases.'
                }
              />
            </li>
          ) : null}
        </ul>
      )}
    </section>
  );
}
