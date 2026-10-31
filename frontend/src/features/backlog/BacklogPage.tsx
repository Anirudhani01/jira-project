import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SlidersHorizontal } from 'lucide-react';
import { useMemo, useRef, useState, type SyntheticEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';

import { NotFoundPage } from '../../app/pages/NotFoundPage';
import { useAppOnline } from '../../app/OnlineStatusProvider';
import { useNavKey } from '../../app/shell/navPrefs';
import { Button } from '../../components/ui/Button';
import { Skeleton } from '../../components/ui/Card';
import { FormError } from '../../components/ui/Form';
import { Input } from '../../components/ui/Input';
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/Overlay';
import { ErrorState } from '../../components/ui/States';
import { useToast } from '../../components/ui/Toast';
import { UxEmptyState, UxSearchEmpty } from '../../components/ux';
import { ApiError } from '../../lib/api/errors';
import type { Issue, Sprint } from '../../lib/api/types';
import { usePersisted } from '../../lib/persistedState';
import { createFeedbackInvocationId, showSuccessToast } from '../../lib/ux/mutationFeedback';
import { mutationErrorMessage } from '../../lib/ux/permissionDenied';
import { useProject } from '../projects/api';

import { useBacklog, useBulkMoveToSprint, useCreateSprint, useMoveToSprint } from './api';
import { BacklogPanel, type SprintAction } from './BacklogPanel';
import type { MoveTarget } from './BacklogRow';
import {
  DEFAULT_FIELDS,
  FIELD_LABELS,
  filterIssues,
  nextSelection,
  openCount,
  type BacklogFields,
  type Density,
} from './backlogState';
import {
  CompleteSprintDialog,
  DeleteSprintDialog,
  EditSprintDialog,
  StartSprintDialog,
} from './SprintDialogs';

const BACKLOG_ID = 'backlog';

function BacklogSkeleton() {
  return (
    <div role="status" aria-live="polite" aria-label="Loading backlog…" className="space-y-4">
      <span className="sr-only">Loading backlog…</span>
      {[0, 1].map((panel) => (
        <div key={panel} className="space-y-2 rounded-lg border border-line bg-surface-2 p-3">
          <Skeleton className="h-5 w-56" />
          {[0, 1, 2].map((row) => (
            <Skeleton key={row} className="h-8 w-full" />
          ))}
        </div>
      ))}
    </div>
  );
}

function ViewSettings({
  density,
  setDensity,
  fields,
  setFields,
}: {
  density: Density;
  setDensity: (d: Density) => void;
  fields: BacklogFields;
  setFields: (f: BacklogFields) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="secondary" size="sm">
          <SlidersHorizontal className="size-4" aria-hidden="true" /> View settings
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 space-y-3 p-3">
        <fieldset className="space-y-1">
          <legend className="text-xs font-semibold text-fg-muted">Density</legend>
          {(['default', 'compact'] as const).map((value) => (
            <label key={value} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="backlog-density"
                checked={density === value}
                onChange={() => {
                  setDensity(value);
                }}
              />
              {value === 'default' ? 'Default' : 'Compact'}
            </label>
          ))}
        </fieldset>
        <fieldset className="space-y-1">
          <legend className="text-xs font-semibold text-fg-muted">Fields</legend>
          {(Object.keys(FIELD_LABELS) as (keyof BacklogFields)[]).map((field) => (
            <label key={field} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={fields[field]}
                onChange={(event) => {
                  setFields({ ...fields, [field]: event.target.checked });
                }}
              />
              {FIELD_LABELS[field]}
            </label>
          ))}
        </fieldset>
      </PopoverContent>
    </Popover>
  );
}

/** Scrum backlog: active and planned sprints, then the unplanned backlog, as collapsible
 * panels. Quick filter, per-user view settings (density, fields), inline create, drag between
 * panels (or the row menu), multi-select with bulk move, and sprint start/complete/edit/delete. */
export function BacklogPage() {
  const { org = '', key = '' } = useParams();
  const [search, setSearch] = useSearchParams();
  const project = useProject(org, key);
  const backlog = useBacklog(org, key);
  const online = useAppOnline();
  const toast = useToast();
  const createSprint = useCreateSprint(org, key);
  const moveOne = useMoveToSprint(org, key);
  const bulk = useBulkMoveToSprint(org, key);
  const [sprintName, setSprintName] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const anchor = useRef<string | null>(null);
  const [dialog, setDialog] = useState<{ action: SprintAction; sprint: Sprint } | null>(null);
  const [bulkTarget, setBulkTarget] = useState(BACKLOG_ID);
  const [density, setDensity] = usePersisted<Density>(useNavKey(org, 'backlog.density'), 'default');
  const [fields, setFields] = usePersisted<BacklogFields>(
    useNavKey(org, 'backlog.fields'),
    DEFAULT_FIELDS,
  );
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );
  const query = search.get('q') ?? '';

  const data = backlog.data;
  const panels = useMemo(() => {
    if (!data) return [];
    return [
      ...data.sprints.map(({ sprint, issues }) => ({
        id: sprint.id,
        title: sprint.name,
        sprint,
        all: issues,
        shown: filterIssues(issues, query),
      })),
      {
        id: BACKLOG_ID,
        title: 'Backlog',
        sprint: null,
        all: data.backlog,
        shown: filterIssues(data.backlog, query),
      },
    ];
  }, [data, query]);

  if (project.isPending || backlog.isPending) return <BacklogSkeleton />;
  if (project.error instanceof ApiError && project.error.status === 404) return <NotFoundPage />;
  if (project.isError) {
    return <ErrorState error={project.error} onRetry={() => void project.refetch()} />;
  }
  if (backlog.isError) {
    return <ErrorState error={backlog.error} onRetry={() => void backlog.refetch()} />;
  }
  if (project.data.board_type !== 'scrum') {
    return (
      <UxEmptyState
        reason="permission_limited"
        title="The backlog is for Scrum projects"
        description="This project uses a Kanban board. Plan work on the board or the issue list."
      />
    );
  }

  const canPlan = project.data.permissions.includes('sprint.manage') && !project.data.archived;
  const loaded = backlog.data;
  const allIssues = panels.flatMap((panel) => panel.all);
  const order = panels.flatMap((panel) => panel.shown.map((issue) => issue.key));
  const targets: MoveTarget[] = [
    { id: BACKLOG_ID, label: 'Backlog' },
    ...loaded.sprints.map(({ sprint }) => ({ id: sprint.id, label: sprint.name })),
  ];
  const futures = loaded.sprints.map((s) => s.sprint).filter((s) => s.state === 'future');
  const totalIssues = allIssues.length;
  const shownTotal = panels.reduce((sum, panel) => sum + panel.shown.length, 0);
  const selectedSet = new Set(selected);

  const setQuery = (value: string) => {
    const next = new URLSearchParams(search);
    if (value) next.set('q', value);
    else next.delete('q');
    setSearch(next, { replace: true });
  };

  const onSelect = (issueKey: string, shiftKey: boolean) => {
    setSelected((current) =>
      nextSelection(current, issueKey, { shift: shiftKey, anchor: anchor.current, order }),
    );
    anchor.current = issueKey;
  };

  const moveIssue = (issue: Issue, sprintId: string | null) => {
    if (!online || (issue.sprint?.id ?? null) === sprintId) return;
    moveOne.mutate({ key: issue.key, version: issue.version, sprintId });
  };

  const moveMany = (issues: Issue[], sprintId: string | null) => {
    const targetLabel =
      targets.find((t) => t.id === (sprintId ?? BACKLOG_ID))?.label ?? 'the backlog';
    bulk.mutate(
      { issues: issues.map((i) => ({ key: i.key, version: i.version })), sprintId },
      {
        onSuccess: (result) => {
          setSelected((current) => current.filter((k) => !result.moved.includes(k)));
          if (result.failed.length === 0) {
            showSuccessToast(toast, {
              feedbackInvocationId: createFeedbackInvocationId(),
              title: `${String(result.moved.length)} ${result.moved.length === 1 ? 'issue' : 'issues'} moved to ${targetLabel}`,
            });
          } else {
            toast({
              title: `${String(result.moved.length)} moved, ${String(result.failed.length)} could not be moved`,
              description: result.failed.map((f) => f.key).join(', '),
              variant: 'error',
            });
          }
        },
      },
    );
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    const issue = allIssues.find((i) => i.key === String(active.id));
    if (!issue || !over) return;
    const sprintId = String(over.id) === BACKLOG_ID ? null : String(over.id);
    if (selectedSet.has(issue.key) && selected.length > 1) {
      moveMany(
        allIssues.filter((i) => selectedSet.has(i.key)),
        sprintId,
      );
      return;
    }
    moveIssue(issue, sprintId);
  };

  const submitSprint = (event: SyntheticEvent) => {
    event.preventDefault();
    if (!online || createSprint.isPending || !sprintName.trim()) return;
    createSprint.mutate(
      { name: sprintName.trim() },
      {
        onSuccess: () => {
          setSprintName('');
        },
      },
    );
  };

  const sprintIssues = (id: string) => loaded.sprints.find((s) => s.sprint.id === id)?.issues ?? [];

  return (
    <section aria-labelledby="backlog-title" className="space-y-4 pb-20">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 id="backlog-title" className="text-2xl font-semibold">
          {loaded.project_key} backlog
        </h1>
        <Link
          className="text-sm text-accent underline"
          to={`/o/${org}/p/${loaded.project_key}/board`}
        >
          Board
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm">
          <span className="sr-only">Filter backlog</span>
          <Input
            type="search"
            className="w-64"
            placeholder="Filter by key, summary, assignee, label"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
          />
        </label>
        <ViewSettings
          density={density}
          setDensity={setDensity}
          fields={fields}
          setFields={setFields}
        />
        {canPlan ? (
          <form onSubmit={submitSprint} className="ml-auto flex items-center gap-2">
            <label className="text-sm">
              <span className="sr-only">Sprint name</span>
              <Input
                required
                maxLength={100}
                placeholder="New sprint name"
                value={sprintName}
                onChange={(event) => {
                  setSprintName(event.target.value);
                }}
              />
            </label>
            <Button
              type="submit"
              variant="primary"
              disabled={!online || createSprint.isPending}
              aria-busy={createSprint.isPending}
            >
              Create sprint
            </Button>
          </form>
        ) : null}
      </div>
      <FormError>
        {createSprint.error
          ? mutationErrorMessage(createSprint.error, 'generic-project')
          : moveOne.error
            ? mutationErrorMessage(moveOne.error, 'issue-mutation')
            : null}
      </FormError>

      {query && shownTotal === 0 && totalIssues > 0 ? (
        <UxSearchEmpty
          query={query}
          scope="issues"
          onClearQuery={() => {
            setQuery('');
          }}
        />
      ) : (
        <DndContext sensors={sensors} onDragEnd={onDragEnd}>
          <div className="space-y-4">
            {panels.map((panel) => (
              <BacklogPanel
                key={panel.id}
                panelId={panel.id}
                title={panel.title}
                sprint={panel.sprint}
                issues={panel.shown}
                totalInPanel={panel.all.length}
                org={org}
                project={key}
                canPlan={canPlan}
                online={online}
                selected={selectedSet}
                onSelect={onSelect}
                targets={targets}
                onMove={moveIssue}
                onSprintAction={(action, sprint) => {
                  setDialog({ action, sprint });
                }}
                fields={fields}
                density={density}
                filtering={Boolean(query)}
              />
            ))}
          </div>
        </DndContext>
      )}
      {loaded.truncated ? (
        <p className="text-sm text-fg-muted">Showing the first 500 issues.</p>
      ) : null}

      {selected.length > 0 && canPlan ? (
        <div
          role="region"
          aria-label="Bulk actions"
          className="fixed bottom-4 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-lg border border-line bg-surface px-4 py-2 shadow-lg"
        >
          <span className="text-sm font-medium">{selected.length} selected</span>
          <label className="flex items-center gap-2 text-sm">
            Move to
            <select
              className="h-8 rounded-md border border-line-strong bg-surface px-2"
              value={bulkTarget}
              onChange={(event) => {
                setBulkTarget(event.target.value);
              }}
            >
              {targets.map((target) => (
                <option key={target.id} value={target.id}>
                  {target.label}
                </option>
              ))}
            </select>
          </label>
          <Button
            variant="primary"
            size="sm"
            disabled={!online || bulk.isPending}
            aria-busy={bulk.isPending}
            onClick={() => {
              moveMany(
                allIssues.filter((i) => selectedSet.has(i.key)),
                bulkTarget === BACKLOG_ID ? null : bulkTarget,
              );
            }}
          >
            Move
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSelected([]);
              anchor.current = null;
            }}
          >
            Clear selection
          </Button>
        </div>
      ) : null}

      {dialog?.action === 'start' ? (
        <StartSprintDialog
          sprint={dialog.sprint}
          org={org}
          project={key}
          online={online}
          onClose={() => {
            setDialog(null);
          }}
        />
      ) : null}
      {dialog?.action === 'complete' ? (
        <CompleteSprintDialog
          sprint={dialog.sprint}
          futures={futures}
          openIssues={openCount(sprintIssues(dialog.sprint.id))}
          org={org}
          project={key}
          online={online}
          onClose={() => {
            setDialog(null);
          }}
        />
      ) : null}
      {dialog?.action === 'edit' ? (
        <EditSprintDialog
          sprint={dialog.sprint}
          org={org}
          project={key}
          online={online}
          onClose={() => {
            setDialog(null);
          }}
        />
      ) : null}
      {dialog?.action === 'delete' ? (
        <DeleteSprintDialog
          sprint={dialog.sprint}
          org={org}
          project={key}
          online={online}
          onClose={() => {
            setDialog(null);
          }}
        />
      ) : null}
    </section>
  );
}
