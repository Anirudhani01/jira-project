import { useDraggable, useDroppable } from '@dnd-kit/core';
import { GripVertical, MoreHorizontal } from 'lucide-react';
import { Link } from 'react-router';

import { Avatar } from '../../components/ui/Avatar';
import { IconButton } from '../../components/ui/Button';
import { PriorityIcon, TypeIcon } from '../../components/ui/IssueIcons';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../components/ui/Overlay';
import { cn } from '../../lib/cn';
import type { Board, Issue } from '../../lib/api/types';

import { allowedColumnIds } from './boardState';

export interface IssueCardProps {
  card: Issue;
  org: string;
  board: Board;
  canMove: boolean;
  onMoveTo: (key: string, columnId: string) => void;
  /** Drag overlay clone — no handle or menu. */
  overlay?: boolean;
}

function LabelChip({ name, color }: { name: string; color: string }) {
  return (
    <span
      className="max-w-[5.5rem] truncate rounded-sm px-1.5 py-0.5 text-[10px] font-medium text-fg"
      style={{ backgroundColor: `${color}33`, borderLeft: `3px solid ${color}` }}
      title={name}
    >
      {name}
    </span>
  );
}

export function IssueCard({
  card,
  org,
  board,
  canMove,
  onMoveTo,
  overlay = false,
}: IssueCardProps) {
  const draggable = useDraggable({ id: card.key, disabled: !canMove || overlay });
  const droppable = useDroppable({ id: card.key, disabled: overlay });
  const allowed = allowedColumnIds(board, card);
  const current = board.columns.find((c) => c.status_ids.includes(card.status.id));

  const setRefs = (node: HTMLLIElement | null) => {
    if (overlay) return;
    draggable.setNodeRef(node);
    droppable.setNodeRef(node);
  };

  const dragLabel = `Drag ${card.key}: ${card.summary}. Press space to pick up.`;

  const issueHref = `/o/${org}/issues/${card.key}`;

  return (
    <li
      ref={setRefs}
      className={cn(
        'group rounded-md border border-line bg-surface p-2.5 text-sm shadow-sm transition-shadow',
        !overlay && draggable.isDragging && 'pointer-events-none opacity-40 shadow-none',
        !overlay && droppable.isOver && 'border-accent ring-1 ring-accent/30',
      )}
    >
      <div className="flex gap-1.5">
        {canMove && !overlay ? (
          <button
            type="button"
            className="mt-0.5 shrink-0 cursor-grab rounded p-0.5 text-fg-subtle hover:bg-surface-hover active:cursor-grabbing"
            aria-label={dragLabel}
            {...draggable.attributes}
            {...draggable.listeners}
          >
            <GripVertical className="size-4" aria-hidden="true" />
          </button>
        ) : (
          <span className="w-5 shrink-0" aria-hidden="true" />
        )}
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-start gap-1.5">
            <TypeIcon kind={card.type.kind} name={card.type.name} className="mt-0.5" />
            <div className="min-w-0 flex-1">
              <Link
                to={issueHref}
                className="block rounded-sm outline-none ring-accent hover:bg-surface-hover focus-visible:ring-2"
              >
                <span className="font-mono text-xs font-medium text-accent">{card.key}</span>
                <p className="line-clamp-2 text-[13px] leading-snug text-fg group-hover:underline">
                  {card.summary}
                </p>
              </Link>
            </div>
            {canMove && !overlay ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <IconButton
                    label={`More actions for ${card.key}`}
                    size="sm"
                    className="opacity-0 group-hover:opacity-100 focus:opacity-100 data-[state=open]:opacity-100"
                  >
                    <MoreHorizontal className="size-4" aria-hidden="true" />
                  </IconButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>Move to</DropdownMenuLabel>
                  {board.columns.map((column) => (
                    <DropdownMenuItem
                      key={column.id}
                      disabled={!allowed.has(column.id) || column.id === current?.id}
                      onSelect={() => {
                        onMoveTo(card.key, column.id);
                      }}
                    >
                      {column.name}
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <Link to={issueHref}>Open issue</Link>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>

          {card.parent ? (
            <Link
              to={`/o/${org}/issues/${card.parent.key}`}
              className="inline-flex max-w-full items-center gap-1 rounded-sm bg-accent-soft px-1.5 py-0.5 text-[11px] font-medium text-accent hover:underline"
              title={card.parent.summary}
            >
              <span className="truncate font-mono">{card.parent.key}</span>
              <span className="truncate text-fg-muted">{card.parent.summary}</span>
            </Link>
          ) : null}

          <div className="flex flex-wrap items-center gap-1.5">
            <PriorityIcon name={card.priority.name} />
            {card.labels.slice(0, 3).map((label) => (
              <LabelChip key={label.id} name={label.name} color={label.color} />
            ))}
            {card.labels.length > 3 ? (
              <span className="text-[10px] text-fg-muted">+{card.labels.length - 3}</span>
            ) : null}
            <span className="ml-auto">
              {card.assignee ? (
                <Avatar name={card.assignee.display_name} size="xs" />
              ) : (
                <span className="text-[11px] text-fg-muted">Unassigned</span>
              )}
            </span>
          </div>
        </div>
      </div>
    </li>
  );
}
