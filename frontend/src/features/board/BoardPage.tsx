import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
} from '@dnd-kit/core';
import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';

import { NotFoundPage } from '../../app/pages/NotFoundPage';
import { EmptyState } from '../../components/ui/Card';
import { useBoardShell } from '../../app/shell/useBoardShell';
import { cn } from '../../lib/cn';
import { ErrorState } from '../../components/ui/States';
import { ApiError } from '../../lib/api/errors';
import type { Board } from '../../lib/api/types';
import { useSession } from '../auth/api';
import { CreateIssueDialog } from '../issues/CreateIssueDialog';
import { useProject } from '../projects/api';

import { useBoard, useMoveCard } from './api';
import { BoardColumnView, COLUMN_PREFIX } from './BoardColumn';
import { BoardPageHeader } from './BoardPageHeader';
import { BoardQuickFilters } from './BoardQuickFilters';
import { BoardSkeleton } from './BoardSkeleton';
import { BoardSprintHeader } from './BoardSprintHeader';
import { boardFiltersActive, filterBoardIssues, parseBoardFilters } from './boardFilters';
import { IssueCard } from './IssueCard';
import { allowedColumnIds, findCard, planMove } from './boardState';

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

/** Prefer the droppable under the cursor; fall back to rectangle overlap (empty column space). */
const boardCollision: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  if (hits.length > 0) return hits;
  return rectIntersection(args);
};

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

/** Kanban / scrum board with quick filters, rich cards, and drag-and-drop. */
export function BoardPage() {
  const { org = '', key = '' } = useParams();
  const navigate = useNavigate();
  const project = useProject(org, key);
  const board = useBoard(org, key);
  const session = useSession();
  const move = useMoveCard(org, key);
  const [dragging, setDragging] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [search] = useSearchParams();
  const filters = parseBoardFilters(search);
  const boardChrome = useBoardShell();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

  if (project.isPending || board.isPending) return <BoardSkeleton />;
  if (project.error instanceof ApiError && project.error.status === 404) return <NotFoundPage />;
  if (project.isError) return <ErrorState error={project.error} />;
  if (board.isError) return <ErrorState error={board.error} />;

  const data = board.data;
  const meId = session.data?.user.id;
  const filtersActive = boardFiltersActive(filters);
  const filtered = filterBoardIssues(data, filters, meId);
  const draggedCard = dragging ? findCard(data, dragging)?.card : undefined;
  const allowedForDrag = draggedCard ? allowedColumnIds(data, draggedCard) : null;
  const canMove = project.data.permissions.includes('issue.transition') && !project.data.archived;
  const canCreate = project.data.permissions.includes('issue.create') && !project.data.archived;
  const canManageSprint =
    project.data.permissions.includes('sprint.manage') && !project.data.archived;

  const startMove = (cardKey: string, columnId: string, index: number) => {
    const plan = planMove(data, cardKey, columnId, index);
    const found = findCard(data, cardKey);
    if (!plan || !found) return;
    move.mutate({ key: cardKey, columnId, index, plan, version: found.card.version });
  };

  const moveTo = (cardKey: string, columnId: string) => {
    const target = data.columns.find((c) => c.id === columnId);
    if (!target) return;
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

  const cardProps = {
    org,
    board: data,
    canMove,
    onMoveTo: moveTo,
  };

  return (
    <section
      aria-labelledby="board-title"
      className={cn('space-y-6', boardChrome && 'board-page min-w-0 space-y-4')}
    >
      <BoardPageHeader
        org={org}
        projectKey={data.project_key}
        titleId="board-title"
        title={`${data.project_key} board`}
        sprintName={data.sprint?.name ?? null}
        boardType={data.board_type}
      />

      <BoardSprintHeader
        board={data}
        org={org}
        projectKey={data.project_key}
        canManageSprint={canManageSprint}
      />

      <BoardQuickFilters board={data} currentUserId={meId} />

      {move.isError ? (
        <p
          role="alert"
          className="rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger"
        >
          Could not move the card: {move.error.message} The board was restored.
        </p>
      ) : null}

      {data.board_type === 'scrum' && !data.sprint ? (
        <EmptyState
          title="No active sprint"
          description="Start a sprint from the backlog to see issues on the board."
          action={{
            label: 'Open backlog',
            onClick: () => {
              void navigate(`/o/${org}/p/${data.project_key}/backlog`);
            },
          }}
        />
      ) : null}

      {data.truncated ? (
        <p className="text-sm text-fg-muted">
          Showing the first 500 cards. Quick filters apply to loaded cards only.
        </p>
      ) : null}

      {!(data.board_type === 'scrum' && !data.sprint) ? (
        <DndContext
          sensors={sensors}
          collisionDetection={boardCollision}
          accessibility={{ announcements: announcements(data) }}
          onDragStart={({ active: dragged }) => {
            setDragging(String(dragged.id));
          }}
          onDragCancel={() => {
            setDragging(null);
          }}
          onDragEnd={onDragEnd}
        >
          {boardChrome ? (
            <div className="board-columns-wrap w-full min-w-0 max-w-full overflow-x-auto pb-2">
              <div className="board-columns-track w-max min-w-full">
                <div className="board-columns grid min-w-0 grid-flow-col auto-cols-[minmax(260px,1fr)] gap-2.5 xl:grid-flow-row xl:grid-cols-4 xl:gap-3">
                  {filtered.columns.map((column, index) => (
                    <BoardColumnView
                      key={column.id}
                      column={column}
                      sourceColumn={data.columns[index] as (typeof data.columns)[number]}
                      boardData={data}
                      dimmed={allowedForDrag !== null && !allowedForDrag.has(column.id)}
                      filteredCount={column.issues.length}
                      filtersActive={filtersActive}
                      canCreate={canCreate}
                      onCreate={() => {
                        setCreating(true);
                      }}
                      {...cardProps}
                    />
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex gap-3 overflow-x-auto pb-2">
              {filtered.columns.map((column, index) => (
                <BoardColumnView
                  key={column.id}
                  column={column}
                  sourceColumn={data.columns[index] as (typeof data.columns)[number]}
                  boardData={data}
                  dimmed={allowedForDrag !== null && !allowedForDrag.has(column.id)}
                  filteredCount={column.issues.length}
                  filtersActive={filtersActive}
                  canCreate={canCreate}
                  onCreate={() => {
                    setCreating(true);
                  }}
                  {...cardProps}
                />
              ))}
            </div>
          )}
          <DragOverlay dropAnimation={null}>
            {draggedCard ? (
              <ul className="w-[17.5rem] list-none">
                <IssueCard card={draggedCard} {...cardProps} overlay />
              </ul>
            ) : null}
          </DragOverlay>
        </DndContext>
      ) : null}

      {creating ? (
        <CreateIssueDialog
          org={org}
          project={data.project_key}
          onClose={() => {
            setCreating(false);
          }}
        />
      ) : null}
    </section>
  );
}
