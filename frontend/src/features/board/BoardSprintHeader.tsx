import { CalendarDays } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';

import { Button } from '../../components/ui/Button';
import { FormError } from '../../components/ui/Form';
import { Dialog, DialogContent, DialogTrigger } from '../../components/ui/Overlay';
import { describeError } from '../../lib/forms';
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
}: {
  sprint: Sprint;
  futures: Sprint[];
  org: string;
  project: string;
}) {
  const complete = useCompleteSprint(org, project);
  const [target, setTarget] = useState('backlog');
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="primary">
          Complete sprint
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
          <FormError>{complete.error ? describeError(complete.error) : null}</FormError>
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
  const backlog = useBacklog(org, projectKey, board.board_type === 'scrum');
  const sprintRef = board.sprint;
  if (board.board_type !== 'scrum' || !sprintRef) return null;

  const detail = backlog.data?.sprints.find((s) => s.sprint.id === sprintRef.id)?.sprint;
  const futures =
    backlog.data?.sprints.map((s) => s.sprint).filter((s) => s.state === 'future') ?? [];
  const left = daysLeft(detail?.end_at);

  return (
    <div className="flex flex-wrap items-start justify-between gap-4 rounded-lg border border-line bg-surface px-4 py-3">
      <div className="space-y-1">
        <div className="flex items-center gap-2 text-sm text-fg-muted">
          <CalendarDays className="size-4" aria-hidden="true" />
          <span className="font-semibold text-fg">{sprintRef.name}</span>
          {detail ? (
            <span>
              {formatDate(detail.start_at)} → {formatDate(detail.end_at)}
              {left !== null ? (
                <span className="ml-2 text-fg-muted">
                  ·{' '}
                  {left < 0
                    ? `${String(Math.abs(left))} days overdue`
                    : `${String(left)} days left`}
                </span>
              ) : null}
            </span>
          ) : backlog.isPending ? (
            <span>Loading dates…</span>
          ) : null}
        </div>
        {detail?.goal ? <p className="max-w-2xl text-sm text-fg-muted">{detail.goal}</p> : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="secondary" size="sm">
          <Link to={`/o/${org}/p/${projectKey}/backlog`}>Backlog</Link>
        </Button>
        {canManageSprint && detail ? (
          <CompleteSprintDialog sprint={detail} futures={futures} org={org} project={projectKey} />
        ) : null}
      </div>
    </div>
  );
}
