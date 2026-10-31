import { useDroppable } from '@dnd-kit/core';
import { ChevronDown, ChevronRight, MoreHorizontal } from 'lucide-react';
import { useState } from 'react';

import { Button, IconButton } from '../../components/ui/Button';
import { Badge, Count } from '../../components/ui/Badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../components/ui/Overlay';
import { UxEmptyState } from '../../components/ux';
import { cn } from '../../lib/cn';
import type { Issue, Sprint } from '../../lib/api/types';

import { BacklogRow, type MoveTarget } from './BacklogRow';
import { statusCounts, type BacklogFields, type Density } from './backlogState';
import { InlineCreate } from './InlineCreate';

const dateFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });
const formatDate = (iso: string | null) => (iso ? dateFormat.format(new Date(iso)) : '');

export type SprintAction = 'start' | 'complete' | 'edit' | 'delete';

/** A collapsible panel: an active or planned sprint, or the unplanned backlog (`sprint` is
 * null). Header: name, state, dates, status-category counts, points and sprint actions. Body:
 * ranked rows or an empty state, then inline create. It is also a drop target. */
export function BacklogPanel({
  panelId,
  title,
  sprint,
  issues,
  totalInPanel,
  org,
  project,
  canPlan,
  online,
  selected,
  onSelect,
  targets,
  onMove,
  onSprintAction,
  fields,
  density,
  filtering,
}: {
  panelId: string;
  title: string;
  sprint: Sprint | null;
  issues: Issue[];
  /** Issues in the panel before the quick filter was applied. */
  totalInPanel: number;
  org: string;
  project: string;
  canPlan: boolean;
  online: boolean;
  selected: ReadonlySet<string>;
  onSelect: (key: string, shiftKey: boolean) => void;
  targets: MoveTarget[];
  onMove: (issue: Issue, sprintId: string | null) => void;
  onSprintAction: (action: SprintAction, sprint: Sprint) => void;
  fields: BacklogFields;
  density: Density;
  filtering: boolean;
}) {
  const [open, setOpen] = useState(true);
  const { setNodeRef, isOver } = useDroppable({ id: panelId });
  const counts = statusCounts(issues);
  const headingId = `panel-${panelId}`;
  const planned = sprint?.state === 'future';
  const active = sprint?.state === 'active';
  const dates =
    sprint?.start_at && sprint.end_at
      ? `${formatDate(sprint.start_at)} – ${formatDate(sprint.end_at)}`
      : '';

  return (
    <section
      ref={setNodeRef}
      aria-labelledby={headingId}
      className={cn('rounded-lg border border-line bg-surface-2', isOver && 'ring-2 ring-accent')}
    >
      <header className="flex flex-wrap items-center gap-2 px-3 py-2">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={`${headingId}-body`}
          aria-label={`${open ? 'Collapse' : 'Expand'} ${title}`}
          onClick={() => {
            setOpen((value) => !value);
          }}
          className="rounded p-0.5 text-fg-muted hover:bg-surface-hover"
        >
          {open ? (
            <ChevronDown className="size-4" aria-hidden="true" />
          ) : (
            <ChevronRight className="size-4" aria-hidden="true" />
          )}
        </button>
        <h2 id={headingId} className="text-sm font-semibold">
          {title}
        </h2>
        {sprint ? (
          <Badge tone={active ? 'success' : 'neutral'}>{active ? 'Active' : 'Planned'}</Badge>
        ) : null}
        {dates ? <span className="text-xs text-fg-muted">{dates}</span> : null}
        <Count>
          {totalInPanel} {totalInPanel === 1 ? 'issue' : 'issues'}
        </Count>
        {issues.length > 0 ? (
          <span className="flex items-center gap-1" aria-label="Issues by status category">
            <Badge tone="neutral" title="To do">
              {counts.todo}
            </Badge>
            <Badge tone="info" title="In progress">
              {counts.in_progress}
            </Badge>
            <Badge tone="success" title="Done">
              {counts.done}
            </Badge>
          </span>
        ) : null}
        {sprint && sprint.points_total > 0 ? (
          <span className="text-xs text-fg-muted">
            {sprint.points_done}/{sprint.points_total} points
          </span>
        ) : null}
        <span className="ml-auto flex items-center gap-1">
          {canPlan && sprint && active ? (
            <Button
              size="sm"
              variant="primary"
              disabled={!online}
              onClick={() => {
                onSprintAction('complete', sprint);
              }}
            >
              Complete sprint
            </Button>
          ) : null}
          {canPlan && sprint && planned ? (
            <Button
              size="sm"
              variant="secondary"
              disabled={!online}
              onClick={() => {
                onSprintAction('start', sprint);
              }}
            >
              Start sprint
            </Button>
          ) : null}
          {canPlan && sprint ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton label={`Sprint actions for ${title}`} size="sm">
                  <MoreHorizontal className="size-4" aria-hidden="true" />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem
                  onSelect={() => {
                    onSprintAction('edit', sprint);
                  }}
                >
                  Edit sprint
                </DropdownMenuItem>
                {planned ? (
                  <DropdownMenuItem
                    onSelect={() => {
                      onSprintAction('delete', sprint);
                    }}
                  >
                    Delete sprint
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </span>
      </header>
      {open ? (
        <div id={`${headingId}-body`} className="space-y-2 px-2 pb-2">
          {sprint?.goal ? (
            <p className="px-1 text-xs text-fg-muted">
              <span className="font-medium">Goal:</span> {sprint.goal}
            </p>
          ) : null}
          {issues.length === 0 ? (
            filtering && totalInPanel > 0 ? (
              <p className="px-1 py-3 text-sm text-fg-muted">No issues here match your filter.</p>
            ) : (
              <UxEmptyState
                reason="no_data"
                title={sprint ? 'Plan your sprint' : 'Your backlog is empty'}
                description={
                  sprint
                    ? 'Drag issues here from the backlog, or create one below.'
                    : 'Create an issue below, or move issues back from a sprint.'
                }
              />
            )
          ) : (
            <ul
              className="overflow-hidden rounded-md border border-line bg-surface"
              aria-label={`${title} issues`}
            >
              {issues.map((issue) => (
                <BacklogRow
                  key={issue.key}
                  issue={issue}
                  org={org}
                  canPlan={canPlan}
                  online={online}
                  selected={selected.has(issue.key)}
                  onSelect={onSelect}
                  targets={targets}
                  onMove={onMove}
                  fields={fields}
                  density={density}
                />
              ))}
            </ul>
          )}
          {canPlan ? (
            <InlineCreate
              org={org}
              project={project}
              sprintId={sprint?.id ?? null}
              online={online}
            />
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
