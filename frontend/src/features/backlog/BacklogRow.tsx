import { useDraggable } from '@dnd-kit/core';
import { GripVertical, MoreHorizontal } from 'lucide-react';
import { Link, useLocation } from 'react-router';

import { Avatar } from '../../components/ui/Avatar';
import { IconButton } from '../../components/ui/Button';
import { PriorityIcon, StatusLozenge, TypeIcon } from '../../components/ui/IssueIcons';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '../../components/ui/Overlay';
import { cn } from '../../lib/cn';
import type { Issue } from '../../lib/api/types';
import { issueDetailLinkProps } from '../issues/issueDetailNavigation';

import type { BacklogFields, Density } from './backlogState';

export interface MoveTarget {
  id: string;
  label: string;
}

/** One issue line in a backlog panel: select, drag handle, type, key, summary, parent chip,
 * labels, points, priority, assignee, status and a menu (also the keyboard alternative to
 * dragging). Fields and density follow the user's view settings. */
export function BacklogRow({
  issue,
  org,
  canPlan,
  online,
  selected,
  onSelect,
  targets,
  onMove,
  fields,
  density,
}: {
  issue: Issue;
  org: string;
  canPlan: boolean;
  online: boolean;
  selected: boolean;
  onSelect: (key: string, shiftKey: boolean) => void;
  targets: MoveTarget[];
  onMove: (issue: Issue, sprintId: string | null) => void;
  fields: BacklogFields;
  density: Density;
}) {
  const location = useLocation();
  const detailLink = issueDetailLinkProps(org, issue.key, location);
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({
    id: issue.key,
    disabled: !canPlan || !online,
  });
  const currentId = issue.sprint?.id ?? 'backlog';

  return (
    <li
      ref={setNodeRef}
      data-issue-row
      data-issue-key={issue.key}
      className={cn(
        'flex items-center gap-2 border-b border-line px-2 text-sm last:border-b-0',
        density === 'compact' ? 'py-0.5' : 'py-1.5',
        selected && 'bg-accent-soft',
        isDragging && 'opacity-50',
      )}
    >
      {canPlan ? (
        <>
          <input
            type="checkbox"
            aria-label={`Select ${issue.key}`}
            checked={selected}
            onChange={() => undefined}
            onClick={(event) => {
              onSelect(issue.key, event.shiftKey);
            }}
          />
          <button
            type="button"
            {...attributes}
            {...listeners}
            aria-label={`Drag ${issue.key}: ${issue.summary}. Press space to pick up.`}
            className="cursor-grab rounded text-fg-subtle hover:bg-surface-hover"
          >
            <GripVertical className="size-4" aria-hidden="true" />
          </button>
        </>
      ) : null}
      {fields.type ? <TypeIcon kind={issue.type.kind} name={issue.type.name} /> : null}
      {fields.key ? (
        <Link
          {...detailLink}
          className="shrink-0 font-mono text-xs font-medium text-accent hover:underline"
        >
          {issue.key}
        </Link>
      ) : null}
      <Link
        {...detailLink}
        className="min-w-0 flex-1 truncate text-fg no-underline hover:underline"
      >
        {issue.summary}
      </Link>
      {fields.epic && issue.parent ? (
        <span
          title={`Parent: ${issue.parent.summary}`}
          className="hidden shrink-0 rounded-sm bg-accent-soft px-1.5 text-[11px] font-medium text-accent sm:inline"
        >
          {issue.parent.key}
        </span>
      ) : null}
      {fields.version && issue.fix_version ? (
        <span
          title={`Fix version: ${issue.fix_version.name}`}
          className="hidden shrink-0 rounded-sm bg-surface-2 px-1.5 text-[11px] text-fg-muted lg:inline"
        >
          {issue.fix_version.name}
        </span>
      ) : null}
      {fields.labels
        ? issue.labels.slice(0, 2).map((label) => (
            <span
              key={label.id}
              className="hidden shrink-0 rounded-sm bg-surface-2 px-1.5 text-[11px] text-fg-muted md:inline"
            >
              {label.name}
            </span>
          ))
        : null}
      {fields.points && issue.story_points !== null ? (
        <span
          title="Story points"
          aria-label={`${String(issue.story_points)} story points`}
          className="shrink-0 rounded-full bg-surface-2 px-1.5 text-xs font-medium text-fg-muted"
        >
          {issue.story_points}
        </span>
      ) : null}
      {fields.priority ? <PriorityIcon name={issue.priority.name} /> : null}
      {fields.assignee ? (
        issue.assignee ? (
          <Avatar name={issue.assignee.display_name} size="xs" />
        ) : (
          <span
            className="size-5 shrink-0 rounded-full border border-dashed border-line-strong"
            title="Unassigned"
          >
            <span className="sr-only">Unassigned</span>
          </span>
        )
      ) : null}
      {fields.status ? (
        <span className="shrink-0">
          <StatusLozenge name={issue.status.name} category={issue.status.category} />
        </span>
      ) : null}
      {canPlan ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton label={`More actions for ${issue.key}`} size="sm" disabled={!online}>
              <MoreHorizontal className="size-4" aria-hidden="true" />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuLabel>Move {issue.key} to</DropdownMenuLabel>
            {targets
              .filter((target) => target.id !== currentId)
              .map((target) => (
                <DropdownMenuItem
                  key={target.id}
                  onSelect={() => {
                    onMove(issue, target.id === 'backlog' ? null : target.id);
                  }}
                >
                  {target.label}
                </DropdownMenuItem>
              ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </li>
  );
}
