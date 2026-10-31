import { CalendarDays, ChevronDown, Target } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';

import { useBoardShell } from '../../app/shell/useBoardShell';
import { Button } from '../../components/ui/Button';
import { cn } from '../../lib/cn';
import { FormError } from '../../components/ui/Form';
import { Dialog, DialogContent, DialogTrigger } from '../../components/ui/Overlay';
import { mutationErrorMessage } from '../../lib/ux/permissionDenied';
import type { Board, Sprint } from '../../lib/api/types';
import { useBacklog, useCompleteSprint } from '../backlog/api';

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(iso));
}

function daysLeft(endAt: string | null | undefined): number | null {
  if (!endAt) return null;
  const end = new Date(endAt);
  const now = new Date();
  const diff = Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  return diff;
}

function CompleteSprintDialog({
  sprint,
  futures,
  org,
  project,
  boardChrome,
}: {
  sprint: Sprint;
  futures: Sprint[];
  org: string;
  project: string;
  boardChrome: boolean;
}) {
  const complete = useCompleteSprint(org, project);
  const [target, setTarget] = useState('backlog');
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="primary"
          className={cn(boardChrome && 'board-btn-primary gap-1 rounded-lg px-3')}
        >
          Complete sprint
          {boardChrome ? <ChevronDown className="size-3.5 opacity-90" aria-hidden="true" /> : null}
        </Button>
      </DialogTrigger>
      <DialogContent
        title={`Complete ${sprint.name}`}
        description="Move open issues before closing the sprint."
      >
        <div className="space-y-3 text-sm">
          <label className="flex flex-col gap-1">
            Move open issues to
            <select
              className="rounded-md border border-line bg-surface px-2 py-1.5"
              value={target}
              onChange={(e) => {
                setTarget(e.target.value);
              }}
            >
              <option value="backlog">Backlog</option>
              {futures.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={complete.isPending}
              onClick={() => {
                complete.mutate(
                  { id: sprint.id, target },
                  {
                    onSuccess: () => {
                      setOpen(false);
                    },
                  },
                );
              }}
            >
              Complete sprint
            </Button>
          </div>
          <FormError>
            {complete.error ? mutationErrorMessage(complete.error, 'generic-project') : null}
          </FormError>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function BoardSprintHeader({
  board,
  org,
  projectKey,
  canManageSprint,
}: {
  board: Board;
  org: string;
  projectKey: string;
  canManageSprint: boolean;
}) {
  const boardChrome = useBoardShell();
  const backlog = useBacklog(org, projectKey, board.board_type === 'scrum');
  const sprintRef = board.sprint;
  if (board.board_type !== 'scrum' || !sprintRef) return null;

  const detail = backlog.data?.sprints.find((s) => s.sprint.id === sprintRef.id)?.sprint;
  const futures =
    backlog.data?.sprints.map((s) => s.sprint).filter((s) => s.state === 'future') ?? [];
  const left = daysLeft(detail?.end_at);

  return (
    <div
      className={cn(
        'flex flex-wrap items-start justify-between gap-4 rounded-lg border border-line bg-surface px-4 py-3',
        boardChrome &&
          'board-sprint-card border-[var(--board-border)] bg-[var(--board-surface)] px-5 py-4',
      )}
    >
      <div className="min-w-0 space-y-2">
        <div
          className={cn(
            'flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-fg-muted',
            boardChrome && 'text-[var(--board-muted)]',
          )}
        >
          <CalendarDays
            className={cn('size-4 shrink-0', boardChrome && 'text-[var(--board-accent)]')}
            aria-hidden="true"
          />
          <span className={cn('font-semibold text-fg', boardChrome && 'text-[var(--board-text)]')}>
            {sprintRef.name}
          </span>
          {detail ? (
            <>
              <span className="hidden sm:inline" aria-hidden="true">
                ·
              </span>
              <span className="whitespace-nowrap">
                {formatDate(detail.start_at)} → {formatDate(detail.end_at)}
              </span>
              {left !== null ? (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="whitespace-nowrap">
                    {left < 0
                      ? `${String(Math.abs(left))} days overdue`
                      : `${String(left)} days left`}
                  </span>
                </>
              ) : null}
            </>
          ) : backlog.isPending ? (
            <span>Loading dates…</span>
          ) : null}
        </div>
        {detail?.goal ? (
          <p
            className={cn(
              'flex max-w-3xl items-start gap-2 text-sm text-fg-muted',
              boardChrome && 'text-[var(--board-muted)]',
            )}
          >
            {boardChrome ? (
              <Target
                className="mt-0.5 size-4 shrink-0 text-[var(--board-accent)]"
                aria-hidden="true"
              />
            ) : null}
            <span>{detail.goal}</span>
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          asChild
          variant="secondary"
          size="sm"
          className={cn(boardChrome && 'board-btn-secondary rounded-lg')}
        >
          <Link to={`/o/${org}/p/${projectKey}/backlog`}>Backlog</Link>
        </Button>
        {canManageSprint && detail ? (
          <CompleteSprintDialog
            sprint={detail}
            futures={futures}
            org={org}
            project={projectKey}
            boardChrome={boardChrome}
          />
        ) : null}
      </div>
    </div>
  );
}
