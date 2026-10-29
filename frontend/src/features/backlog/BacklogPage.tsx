import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { useState, type SyntheticEvent } from 'react';
import { Link, useParams } from 'react-router';

import { NotFoundPage } from '../../app/pages/NotFoundPage';
import { FormError } from '../../components/ui/Form';
import { ErrorState, LoadingState } from '../../components/ui/States';
import { ApiError } from '../../lib/api/errors';
import type { Issue, Sprint } from '../../lib/api/types';
import { describeError } from '../../lib/forms';
import { useProject } from '../projects/api';

import {
  useBacklog,
  useCompleteSprint,
  useCreateSprint,
  useDeleteSprint,
  useMoveToSprint,
  useStartSprint,
} from './api';

const BACKLOG_ID = 'backlog';

interface RowProps {
  issue: Issue;
  org: string;
  canPlan: boolean;
  targets: { id: string; label: string }[];
  onMove: (issue: Issue, sprintId: string | null) => void;
}

function IssueRow({ issue, org, canPlan, targets, onMove }: RowProps) {
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({
    id: issue.key,
    disabled: !canPlan,
  });
  return (
    <li
      ref={setNodeRef}
      className={`flex items-center justify-between gap-2 rounded border border-slate-200 bg-white px-2 py-1 text-sm ${isDragging ? 'opacity-50' : ''}`}
    >
      <span className="flex items-center gap-2">
        {canPlan ? (
          <button
            type="button"
            {...attributes}
            {...listeners}
            aria-label={`Drag ${issue.key}: ${issue.summary}. Press space to pick up.`}
            className="cursor-grab rounded px-1 text-slate-500 hover:bg-slate-100"
          >
            <span aria-hidden="true">⠿</span>
          </button>
        ) : null}
        <span>
          <Link className="text-blue-700 underline" to={`/o/${org}/issues/${issue.key}`}>
            {issue.key}
          </Link>{' '}
          {issue.summary}
          <span className="ml-2 text-xs text-slate-600">{issue.status.name}</span>
        </span>
      </span>
      {canPlan ? (
        <label className="text-xs">
          <span className="sr-only">Move {issue.key} to</span>
          <select
            className="rounded border border-slate-300 px-1"
            value={issue.sprint?.id ?? BACKLOG_ID}
            onChange={(e) => {
              onMove(issue, e.target.value === BACKLOG_ID ? null : e.target.value);
            }}
          >
            {targets.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </li>
  );
}

function Section(props: { id: string; title: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: props.id });
  return (
    <section
      ref={setNodeRef}
      aria-label={props.title}
      className={`space-y-2 rounded bg-slate-100 p-3 ${isOver ? 'ring-2 ring-blue-500' : ''}`}
    >
      {props.children}
    </section>
  );
}

function StartForm({ sprint, org, project }: { sprint: Sprint; org: string; project: string }) {
  const start = useStartSprint(org, project);
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  if (!open) {
    return (
      <button
        type="button"
        className="text-blue-700 underline"
        onClick={() => {
          setOpen(true);
        }}
      >
        Start sprint
      </button>
    );
  }
  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    start.mutate(
      { id: sprint.id, start_at: new Date(from).toISOString(), end_at: new Date(to).toISOString() },
      {
        onSuccess: () => {
          setOpen(false);
        },
      },
    );
  };
  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-2 text-sm">
      <label>
        Start
        <input
          type="datetime-local"
          required
          value={from}
          onChange={(e) => {
            setFrom(e.target.value);
          }}
          className="ml-1 rounded border border-slate-300 px-1"
        />
      </label>
      <label>
        End
        <input
          type="datetime-local"
          required
          value={to}
          onChange={(e) => {
            setTo(e.target.value);
          }}
          className="ml-1 rounded border border-slate-300 px-1"
        />
      </label>
      <button type="submit" className="rounded bg-blue-700 px-2 py-1 text-white">
        Start
      </button>
      <FormError>{start.error ? describeError(start.error) : null}</FormError>
    </form>
  );
}

function CompleteForm(props: { sprint: Sprint; futures: Sprint[]; org: string; project: string }) {
  const { sprint, futures, org, project } = props;
  const complete = useCompleteSprint(org, project);
  const [target, setTarget] = useState('backlog');
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <label>
        Move open issues to{' '}
        <select
          value={target}
          onChange={(e) => {
            setTarget(e.target.value);
          }}
          className="rounded border border-slate-300 px-1"
        >
          <option value="backlog">Backlog</option>
          {futures.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="rounded bg-blue-700 px-2 py-1 text-white"
        onClick={() => {
          complete.mutate({ id: sprint.id, target });
        }}
      >
        Complete sprint
      </button>
      <FormError>{complete.error ? describeError(complete.error) : null}</FormError>
    </div>
  );
}

/** Scrum backlog: sprints (active first) then the unplanned backlog. Drag an issue onto a
 * section, or use its "Move to" menu, to plan it. */
export function BacklogPage() {
  const { org = '', key = '' } = useParams();
  const project = useProject(org, key);
  const backlog = useBacklog(org, key);
  const create = useCreateSprint(org, key);
  const remove = useDeleteSprint(org, key);
  const move = useMoveToSprint(org, key);
  const [name, setName] = useState('');
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

  if (project.isPending || backlog.isPending) return <LoadingState label="Loading backlog" />;
  if (project.error instanceof ApiError && project.error.status === 404) return <NotFoundPage />;
  if (project.isError) return <ErrorState error={project.error} />;
  if (backlog.isError) return <ErrorState error={backlog.error} />;
  const data = backlog.data;
  const canPlan = project.data.permissions.includes('sprint.manage') && !project.data.archived;
  const targets = [
    { id: BACKLOG_ID, label: 'Backlog' },
    ...data.sprints.map(({ sprint }) => ({ id: sprint.id, label: sprint.name })),
  ];
  const futures = data.sprints.map((s) => s.sprint).filter((s) => s.state === 'future');
  const allIssues = [...data.sprints.flatMap((s) => s.issues), ...data.backlog];

  const moveIssue = (issue: Issue, sprintId: string | null) => {
    if ((issue.sprint?.id ?? null) === sprintId) return;
    move.mutate({ key: issue.key, version: issue.version, sprintId });
  };
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    const issue = allIssues.find((i) => i.key === String(active.id));
    if (!issue || !over) return;
    moveIssue(issue, String(over.id) === BACKLOG_ID ? null : String(over.id));
  };
  const rows = (issues: Issue[]) =>
    issues.length === 0 ? (
      <p className="text-sm text-slate-600">No issues.</p>
    ) : (
      <ul className="space-y-1">
        {issues.map((issue) => (
          <IssueRow
            key={issue.key}
            issue={issue}
            org={org}
            canPlan={canPlan}
            targets={targets}
            onMove={moveIssue}
          />
        ))}
      </ul>
    );

  return (
    <section aria-labelledby="backlog-title" className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 id="backlog-title" className="text-2xl font-semibold">
          {data.project_key} backlog
        </h1>
        <Link className="text-blue-700 underline" to={`/o/${org}/p/${data.project_key}/board`}>
          Board
        </Link>
      </div>
      <FormError>{move.error ? describeError(move.error) : null}</FormError>
      {canPlan ? (
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate(
              { name },
              {
                onSuccess: () => {
                  setName('');
                },
              },
            );
          }}
        >
          <label className="text-sm">
            <span className="sr-only">Sprint name</span>
            <input
              required
              maxLength={100}
              placeholder="New sprint name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
              }}
              className="rounded border border-slate-300 px-2 py-1"
            />
          </label>
          <button type="submit" className="rounded bg-blue-700 px-3 py-1 text-white">
            Create sprint
          </button>
          <FormError>{create.error ? describeError(create.error) : null}</FormError>
        </form>
      ) : null}
      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className="space-y-4">
          {data.sprints.map(({ sprint, issues }) => (
            <Section key={sprint.id} id={sprint.id} title={sprint.name}>
              <div className="flex items-center justify-between">
                <h2 className="font-semibold">
                  {sprint.name}{' '}
                  <span className="text-xs font-normal text-slate-600">
                    {sprint.state === 'active' ? 'Active' : 'Planned'} · {sprint.issue_count} issues
                  </span>
                </h2>
                {canPlan && sprint.state === 'future' ? (
                  <span className="flex gap-3">
                    <StartForm sprint={sprint} org={org} project={key} />
                    <button
                      type="button"
                      className="text-red-700 underline"
                      onClick={() => {
                        remove.mutate(sprint.id);
                      }}
                    >
                      Delete sprint
                    </button>
                  </span>
                ) : null}
              </div>
              {canPlan && sprint.state === 'active' ? (
                <CompleteForm sprint={sprint} futures={futures} org={org} project={key} />
              ) : null}
              {rows(issues)}
            </Section>
          ))}
          <Section id={BACKLOG_ID} title="Backlog">
            <h2 className="font-semibold">Backlog</h2>
            {rows(data.backlog)}
          </Section>
        </div>
      </DndContext>
      {data.truncated ? (
        <p className="text-sm text-slate-600">Showing the first 500 issues.</p>
      ) : null}
    </section>
  );
}
