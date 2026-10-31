import { useDraggable, useDroppable } from '@dnd-kit/core';
import { GripVertical, MoreHorizontal } from 'lucide-react';
import { Link, useLocation } from 'react-router';

import { issueDetailLinkProps } from '../issues/issueDetailNavigation';

import { useBoardShell } from '../../app/shell/useBoardShell';
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

function LabelChip({
  name,
  color,
  boardChrome,
}: {
  name: string;
  color: string;
  boardChrome?: boolean;
}) {
  if (boardChrome) {
    return (
      <span
        className="board-issue-label max-w-[5.5rem] truncate rounded px-1.5 py-0.5 text-[10px] font-medium"
        style={{
          backgroundColor: `color-mix(in srgb, ${color} 14%, #ffffff)`,
          color: '#334155',
          border: `1px solid color-mix(in srgb, ${color} 35%, #cbd5e1)`,
        }}
        title={name}
      >
        {name}
      </span>
    );
  }
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

function IssueCardMoveMenu({
  card,
  board,
  allowed,
  currentColumnId,
  onMoveTo,
  detailLink,
  boardChrome,
  className,
}: {
  card: Issue;
  board: Board;
  allowed: Set<string>;
  currentColumnId: string | undefined;
  onMoveTo: (key: string, columnId: string) => void;
  detailLink: ReturnType<typeof issueDetailLinkProps>;
  boardChrome?: boolean;
  className?: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton
          label={`More actions for ${card.key}`}
          size="sm"
          className={cn(
            boardChrome
              ? 'board-issue-menu shrink-0 text-[var(--board-muted)]'
              : 'opacity-0 group-hover:opacity-100 focus:opacity-100 data-[state=open]:opacity-100',
            className,
          )}
        >
          <MoreHorizontal className="size-4" aria-hidden="true" />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Move to</DropdownMenuLabel>
        {board.columns.map((column) => (
          <DropdownMenuItem
            key={column.id}
            disabled={!allowed.has(column.id) || column.id === currentColumnId}
            onSelect={() => {
              onMoveTo(card.key, column.id);
            }}
          >
            {column.name}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link {...detailLink}>Open issue</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DragHandle({
  dragLabel,
  attributes,
  listeners,
  boardChrome,
}: {
  dragLabel: string;
  attributes: ReturnType<typeof useDraggable>['attributes'];
  listeners: ReturnType<typeof useDraggable>['listeners'];
  boardChrome?: boolean;
}) {
  return (
    <button
      type="button"
      className={cn(
        'shrink-0 cursor-grab rounded p-0.5 text-fg-subtle hover:bg-surface-hover active:cursor-grabbing',
        boardChrome
          ? 'board-issue-drag mt-1 text-[var(--board-muted)] hover:bg-[var(--board-accent-soft)]'
          : 'mt-0.5',
      )}
      aria-label={dragLabel}
      {...attributes}
      {...listeners}
    >
      <GripVertical className="size-4" aria-hidden="true" />
    </button>
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
  const boardChrome = useBoardShell();
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

  const location = useLocation();
  const detailLink = issueDetailLinkProps(org, card.key, location);
  const parentDetailLink = card.parent
    ? issueDetailLinkProps(org, card.parent.key, location)
    : null;

  const cardShellClass = cn(
    'group text-sm transition-shadow',
    boardChrome
      ? 'board-issue-card rounded-lg border border-[var(--board-border)] bg-[var(--board-surface)] p-2 shadow-[0_1px_2px_rgb(15_23_42/6%)]'
      : 'rounded-md border border-line bg-surface p-2.5 shadow-sm',
    !overlay && draggable.isDragging && 'pointer-events-none opacity-40 shadow-none',
    !overlay &&
      droppable.isOver &&
      (boardChrome
        ? 'border-[var(--board-accent)] ring-1 ring-[var(--board-accent)]/30'
        : 'border-accent ring-1 ring-accent/30'),
  );

  const footerMeta = (
    <>
      {boardChrome ? (
        <PriorityIcon name={card.priority.name} className="opacity-90 [&_svg]:size-3.5" />
      ) : (
        <PriorityIcon name={card.priority.name} />
      )}
      {card.story_points !== null ? (
        <span
          title="Story points"
          aria-label={`${String(card.story_points)} story points`}
          className={cn(
            'ml-auto rounded-full px-1.5 text-[10px] font-semibold',
            boardChrome
              ? 'bg-[var(--board-accent-soft)] text-[var(--board-muted)]'
              : 'bg-surface-2 text-fg-muted',
          )}
        >
          {card.story_points}
        </span>
      ) : null}
      {card.labels.slice(0, 3).map((label) => (
        <LabelChip key={label.id} name={label.name} color={label.color} boardChrome={boardChrome} />
      ))}
      {card.labels.length > 3 ? (
        <span
          className={cn('text-[10px]', boardChrome ? 'text-[var(--board-muted)]' : 'text-fg-muted')}
        >
          +{card.labels.length - 3}
        </span>
      ) : null}
      <span className="ml-auto shrink-0">
        {card.assignee ? (
          <Avatar name={card.assignee.display_name} size="xs" />
        ) : boardChrome ? null : (
          <span className="text-[11px] text-fg-muted">Unassigned</span>
        )}
      </span>
    </>
  );

  if (boardChrome) {
    return (
      <li ref={setRefs} data-issue-row data-issue-key={card.key} className={cardShellClass}>
        <div className="flex gap-1">
          {canMove && !overlay ? (
            <DragHandle
              dragLabel={dragLabel}
              attributes={draggable.attributes}
              listeners={draggable.listeners}
              boardChrome
            />
          ) : (
            <span className="w-5 shrink-0" aria-hidden="true" />
          )}
          <div className="flex min-h-[4.25rem] min-w-0 flex-1 flex-col gap-1">
            <div className="flex items-start justify-between gap-1">
              <div className="flex min-w-0 items-center gap-1.5">
                <TypeIcon kind={card.type.kind} name={card.type.name} className="size-4 shrink-0" />
                <Link
                  {...detailLink}
                  className="board-issue-key truncate font-mono text-xs font-semibold no-underline outline-none hover:underline focus-visible:ring-2 focus-visible:ring-[var(--board-accent)]"
                >
                  {card.key}
                </Link>
              </div>
              {canMove && !overlay ? (
                <IssueCardMoveMenu
                  card={card}
                  board={board}
                  allowed={allowed}
                  currentColumnId={current?.id}
                  onMoveTo={onMoveTo}
                  detailLink={detailLink}
                  boardChrome
                />
              ) : null}
            </div>
            <Link
              {...detailLink}
              className="board-issue-summary line-clamp-2 min-h-[2.35rem] text-[13px] leading-snug text-[var(--board-text)] no-underline outline-none hover:text-[var(--board-link)] focus-visible:ring-2 focus-visible:ring-[var(--board-accent)]"
            >
              {card.summary}
            </Link>
            {card.parent && parentDetailLink ? (
              <Link
                {...parentDetailLink}
                className="inline-flex max-w-full items-center gap-1 truncate rounded bg-[var(--board-accent-soft)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--board-link)] no-underline hover:underline"
                title={card.parent.summary}
              >
                <span className="font-mono">{card.parent.key}</span>
                <span className="truncate text-[var(--board-muted)]">{card.parent.summary}</span>
              </Link>
            ) : null}
            <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-0.5">{footerMeta}</div>
          </div>
        </div>
      </li>
    );
  }

  return (
    <li ref={setRefs} data-issue-row data-issue-key={card.key} className={cardShellClass}>
      <div className="flex gap-1.5">
        {canMove && !overlay ? (
          <DragHandle
            dragLabel={dragLabel}
            attributes={draggable.attributes}
            listeners={draggable.listeners}
          />
        ) : (
          <span className="w-5 shrink-0" aria-hidden="true" />
        )}
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-start gap-1.5">
            <TypeIcon kind={card.type.kind} name={card.type.name} className="mt-0.5" />
            <div className="min-w-0 flex-1">
              <Link
                {...detailLink}
                className="block rounded-sm outline-none ring-accent hover:bg-surface-hover focus-visible:ring-2"
              >
                <span className="font-mono text-xs font-medium text-accent">{card.key}</span>
                <p className="line-clamp-2 text-[13px] leading-snug text-fg group-hover:underline">
                  {card.summary}
                </p>
              </Link>
            </div>
            {canMove && !overlay ? (
              <IssueCardMoveMenu
                card={card}
                board={board}
                allowed={allowed}
                currentColumnId={current?.id}
                onMoveTo={onMoveTo}
                detailLink={detailLink}
              />
            ) : null}
          </div>

          {card.parent && parentDetailLink ? (
            <Link
              {...parentDetailLink}
              className="inline-flex max-w-full items-center gap-1 rounded-sm bg-accent-soft px-1.5 py-0.5 text-[11px] font-medium text-accent hover:underline"
              title={card.parent.summary}
            >
              <span className="truncate font-mono">{card.parent.key}</span>
              <span className="truncate text-fg-muted">{card.parent.summary}</span>
            </Link>
          ) : null}

          <div className="flex flex-wrap items-center gap-1.5">{footerMeta}</div>
        </div>
      </div>
    </li>
  );
}
