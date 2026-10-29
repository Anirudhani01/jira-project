import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
} from '@dnd-kit/core';
import { useState } from 'react';
import { Link, useParams } from 'react-router';

import { NotFoundPage } from '../../app/pages/NotFoundPage';
import { ErrorState, LoadingState } from '../../components/ui/States';
import { ApiError } from '../../lib/api/errors';
import type { Board, BoardColumn, Issue } from '../../lib/api/types';
import { useProject } from '../projects/api';

import { useBoard, useMoveCard } from './api';
import { allowedColumnIds, findCard, planMove } from './boardState';

const COLUMN_PREFIX = 'column:';

function describeCard(board: Board, id: string | number | undefined): string {
  const found = typeof id === 'string' ? findCard(board, id) : null;
  return found ? `${found.card.key} ${found.card.summary}` : 'card';
}

function describeTarget(board: Board, id: string | number | undefined): string {
  if (typeof id !== 'string') return 'no drop target';
  if (id.startsWith(COLUMN_PREFIX)) {
    return `column ${board.columns.find((c) => c.id === id.slice(COLUMN_PREFIX.length))?.name ?? ''}`;
  }
  const found = findCard(board, id);
  return found
    ? `${board.columns[found.columnIndex]?.name ?? ''} next to ${found.card.key}`
    : 'a card';
}

function announcements(board: Board): Announcements {
  return {
    onDragStart: ({ active }) => `Picked up ${describeCard(board, active.id)}.`,
    onDragOver: ({ active, over }) =>
      `${describeCard(board, active.id)} is over ${describeTarget(board, over?.id)}.`,
    onDragEnd: ({ active, over }) =>
      over
        ? `Dropped ${describeCard(board, active.id)} on ${describeTarget(board, over.id)}.`
        : `Dropped ${describeCard(board, active.id)} outside a column; nothing changed.`,
    onDragCancel: ({ active }) => `Cancelled moving ${describeCard(board, active.id)}.`,
  };
}

interface CardProps {
  card: Issue;
  org: string;
  board: Board;
  canMove: boolean;
  onMoveTo: (key: string, columnId: string) => void;
}

function Card({ card, org, board, canMove, onMoveTo }: CardProps) {
  const {
    setNodeRef: setDragRef,
    attributes,
    listeners,
    isDragging,
  } = useDraggable({
    id: card.key,
    disabled: !canMove,
  });
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: card.key });
  const allowed = allowedColumnIds(board, card);
  const current = board.columns.find((c) => c.status_ids.includes(card.status.id));
  return (
    <li
      ref={(node) => {
        setDragRef(node);
        setDropRef(node);
      }}
      className={`rounded border bg-white p-2 text-sm shadow-sm ${isDragging ? 'opacity-50' : ''} ${isOver ? 'border-blue-500' : 'border-slate-200'}`}
    >
      <div
        {...attributes}
        {...listeners}
        aria-label={`${card.key}: ${card.summary}. Press space to pick up.`}
        className={canMove ? 'cursor-grab' : ''}
      >
        <Link className="text-blue-700 underline" to={`/o/${org}/issues/${card.key}`}>
          {card.key}
        </Link>{' '}
        {card.summary}
      </div>
      <div className="mt-1 flex items-center justify-between text-xs text-slate-600">
        <span>{card.assignee?.display_name ?? 'Unassigned'}</span>
        {canMove ? (
          <label>
            <span className="sr-only">Move {card.key} to</span>
            <select
              className="rounded border border-slate-300 px-1"
              value={current?.id ?? ''}
              onChange={(e) => {
                onMoveTo(card.key, e.target.value);
              }}
            >
              {board.columns.map((column) => (
                <option key={column.id} value={column.id} disabled={!allowed.has(column.id)}>
                  {column.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
    </li>
  );
}

function Column(props: { column: BoardColumn; dimmed: boolean } & Omit<CardProps, 'card'>) {
  const { column, dimmed, ...rest } = props;
  const { setNodeRef, isOver } = useDroppable({
    id: `${COLUMN_PREFIX}${column.id}`,
    disabled: dimmed,
  });
  return (
    <section
      ref={setNodeRef}
      aria-labelledby={`col-${column.id}`}
      className={`flex w-72 shrink-0 flex-col rounded bg-slate-100 p-2 ${dimmed ? 'opacity-40' : ''} ${isOver ? 'ring-2 ring-blue-500' : ''}`}
    >
      <h2 id={`col-${column.id}`} className="mb-2 flex justify-between text-sm font-semibold">
        <span>{column.name}</span>
        <span className={column.over_wip_limit ? 'font-bold text-red-700' : 'text-slate-600'}>
          {column.count}
          {column.wip_limit !== null ? ` / ${String(column.wip_limit)}` : ''}
          {column.over_wip_limit ? ' (over WIP limit)' : ''}
        </span>
      </h2>
      <ul className="min-h-12 space-y-2">
        {column.issues.map((card) => (
          <Card key={card.key} card={card} {...rest} />
        ))}
      </ul>
    </section>
  );
}

/** Kanban board: drag with pointer or keyboard, or use each card's "Move to" menu. */
export function BoardPage() {
  const { org = '', key = '' } = useParams();
  const project = useProject(org, key);
  const board = useBoard(org, key);
  const move = useMoveCard(org, key);
  const [dragging, setDragging] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

  if (project.isPending || board.isPending) return <LoadingState label="Loading board" />;
  if (project.error instanceof ApiError && project.error.status === 404) return <NotFoundPage />;
  if (project.isError) return <ErrorState error={project.error} />;
  if (board.isError) return <ErrorState error={board.error} />;
  const data = board.data;
  const draggedCard = dragging ? findCard(data, dragging)?.card : undefined;
  const allowedForDrag = draggedCard ? allowedColumnIds(data, draggedCard) : null;
  const canMove = project.data.permissions.includes('issue.transition') && !project.data.archived;

  const startMove = (cardKey: string, columnId: string, index: number) => {
    const plan = planMove(data, cardKey, columnId, index);
    const found = findCard(data, cardKey);
    if (!plan || !found) return;
    move.mutate({ key: cardKey, columnId, index, plan, version: found.card.version });
  };

  const moveTo = (cardKey: string, columnId: string) => {
    const target = data.columns.find((c) => c.id === columnId);
    if (!target) return;
    // Menu moves append to the end of the column.
    startMove(cardKey, columnId, target.issues.filter((c) => c.key !== cardKey).length);
  };

  const onDragEnd = ({ active: dragged, over }: DragEndEvent) => {
    setDragging(null);
    if (!over) return;
    const cardKey = String(dragged.id);
    const overId = String(over.id);
    if (overId === cardKey) return;
    if (overId.startsWith(COLUMN_PREFIX)) {
      moveTo(cardKey, overId.slice(COLUMN_PREFIX.length));
      return;
    }
    const origin = findCard(data, cardKey);
    const target = findCard(data, overId);
    if (!origin || !target) return;
    const column = data.columns[target.columnIndex];
    if (!column) return;
    const others = column.issues.filter((c) => c.key !== cardKey);
    const overIndex = others.findIndex((c) => c.key === overId);
    const below = origin.columnIndex === target.columnIndex && origin.index < target.index;
    startMove(cardKey, column.id, below ? overIndex + 1 : overIndex);
  };

  return (
    <section aria-labelledby="board-title" className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 id="board-title" className="text-2xl font-semibold">
          {data.project_key} board
        </h1>
        <Link className="text-blue-700 underline" to={`/o/${org}/p/${data.project_key}/issues`}>
          List view
        </Link>
      </div>
      {move.isError ? (
        <p role="alert" className="rounded bg-red-50 p-2 text-sm text-red-800">
          Could not move the card: {move.error.message} The board was restored.
        </p>
      ) : null}
      {data.truncated ? (
        <p className="text-sm text-slate-600">Showing the first 500 cards.</p>
      ) : null}
      <DndContext
        sensors={sensors}
        accessibility={{ announcements: announcements(data) }}
        onDragStart={({ active: dragged }) => {
          setDragging(String(dragged.id));
        }}
        onDragCancel={() => {
          setDragging(null);
        }}
        onDragEnd={onDragEnd}
      >
        <div className="flex gap-3 overflow-x-auto pb-2">
          {data.columns.map((column) => (
            <Column
              key={column.id}
              column={column}
              dimmed={allowedForDrag !== null && !allowedForDrag.has(column.id)}
              org={org}
              board={data}
              canMove={canMove}
              onMoveTo={moveTo}
            />
          ))}
        </div>
      </DndContext>
    </section>
  );
}
