import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SlidersHorizontal } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type SyntheticEvent } from 'react';
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
import type { Issue, Sprint, Version } from '../../lib/api/types';
import { shouldIgnoreShortcut } from '../../lib/keyboard';
import { usePersisted } from '../../lib/persistedState';
import { createFeedbackInvocationId, showSuccessToast } from '../../lib/ux/mutationFeedback';
import { mutationErrorMessage } from '../../lib/ux/permissionDenied';
import { CreateIssueDialog } from '../issues/CreateIssueDialog';
import { useProject } from '../projects/api';

import { useBacklog, useCreateSprint, useMoveToSprint } from './api';
import { BacklogPanel, type SprintAction } from './BacklogPanel';
import type { MoveTarget } from './BacklogRow';
import {
  DEFAULT_FIELDS,
  FIELD_LABELS,
  NONE,
  filterByPlan,
  filterIssues,
  nextSelection,
  openCount,
  type BacklogFields,
  type Density,
} from './backlogState';
import { BulkBar } from './BulkBar';
import { EpicsPanel } from './EpicsPanel';
import {
  useBulkChange,
  useEpics,
  useSetIssueField,
  useVersionAction,
  useVersions,
  type BulkAction,
} from './planApi';
import {
  CompleteSprintDialog,
  DeleteSprintDialog,
  EditSprintDialog,
  StartSprintDialog,
} from './SprintDialogs';
import { DeleteVersionDialog, ReleaseVersionDialog, VersionFormDialog } from './VersionDialogs';
import { VersionsPanel, type VersionAction } from './VersionsPanel';

const BACKLOG_ID = 'backlog';
type PanelKind = 'epics' | 'versions' | null;
type VersionDialogState =
  { kind: 'create' } | { kind: 'edit' | 'release' | 'delete'; version: Version };

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
 * panels. Quick filter, per-user view settings, a left Epics / Versions panel (keys E / V) that
 * filters the backlog and accepts dropped issues, inline create, drag between panels (or the
 * row menu), multi-select with a bulk bar, and sprint and version management. */
export function BacklogPage() {
  const { org = '', key = '' } = useParams();
  const [search, setSearch] = useSearchParams();
  const project = useProject(org, key);
  const backlog = useBacklog(org, key);
  const online = useAppOnline();
  const toast = useToast();
  const createSprint = useCreateSprint(org, key);
  const moveOne = useMoveToSprint(org, key);
  const bulkChange = useBulkChange(org, key);
  const setField = useSetIssueField(org, key);
  const versionAction = useVersionAction(org, key);
  const [sprintName, setSprintName] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const anchor = useRef<string | null>(null);
  const [dialog, setDialog] = useState<{ action: SprintAction; sprint: Sprint } | null>(null);
  const [versionDialog, setVersionDialog] = useState<VersionDialogState | null>(null);
  const [creatingEpic, setCreatingEpic] = useState(false);
  const [includeDone, setIncludeDone] = useState(false);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [panel, setPanel] = usePersisted<PanelKind>(useNavKey(org, 'backlog.panel'), null);
  const [density, setDensity] = usePersisted<Density>(useNavKey(org, 'backlog.density'), 'default');
  const [storedFields, setFields] = usePersisted<BacklogFields>(
    useNavKey(org, 'backlog.fields'),
    DEFAULT_FIELDS,
  );
  const fields: BacklogFields = { ...DEFAULT_FIELDS, ...storedFields };
  const epics = useEpics(org, key, false, panel === 'epics');
  const versions = useVersions(org, key, false, panel === 'versions');
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );
  const query = search.get('q') ?? '';
  const epicFilter = search.get('epic') ?? '';
  const versionFilter = search.get('version') ?? '';

  // E and V open the Epics and Versions panels (pressing again closes), like the reference.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (shouldIgnoreShortcut(event)) return;
      const pressed = event.key.toLowerCase();
      if (pressed === 'e') setPanel(panel === 'epics' ? null : 'epics');
      else if (pressed === 'v') setPanel(panel === 'versions' ? null : 'versions');
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [panel, setPanel]);

  const data = backlog.data;
  const panels = useMemo(() => {
    if (!data) return [];
    const shown = (issues: Issue[]) =>
      filterByPlan(filterIssues(issues, query), { epic: epicFilter, version: versionFilter });
    return [
      ...data.sprints.map(({ sprint, issues }) => ({
        id: sprint.id,
        title: sprint.name,
        sprint,
        all: issues,
        shown: shown(issues),
      })),
      {
        id: BACKLOG_ID,
        title: 'Backlog',
        sprint: null,
        all: data.backlog,
        shown: shown(data.backlog),
      },
    ];
  }, [data, query, epicFilter, versionFilter]);

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

  const permissions = project.data.permissions;
  const writable = !project.data.archived;
  const canPlan = permissions.includes('sprint.manage') && writable;
  const canManageVersions = permissions.includes('version.manage') && writable;
  const canCreate = permissions.includes('issue.create') && writable;
  const loaded = backlog.data;
  const allIssues = panels.flatMap((p) => p.all);
  const order = panels.flatMap((p) => p.shown.map((issue) => issue.key));
  const targets: MoveTarget[] = [
    { id: BACKLOG_ID, label: 'Backlog' },
    ...loaded.sprints.map(({ sprint }) => ({ id: sprint.id, label: sprint.name })),
  ];
  const futures = loaded.sprints.map((s) => s.sprint).filter((s) => s.state === 'future');
  const totalIssues = allIssues.length;
  const shownTotal = panels.reduce((sum, p) => sum + p.shown.length, 0);
  const selectedSet = new Set(selected);
  const filtering = Boolean(query || epicFilter || versionFilter);
  const otherVersions = versions.data ?? [];

  const setParam = (name: string, value: string) => {
    const next = new URLSearchParams(search);
    if (value) next.set(name, value);
    else next.delete(name);
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

  const changeMany = (issues: Issue[], change: BulkAction, label: string) => {
    bulkChange.mutate(
      { keys: issues.map((i) => i.key), change },
      {
        onSuccess: (result) => {
          const changed = result.results.filter((r) => r.ok).map((r) => r.key);
          setSelected((current) => current.filter((k) => !changed.includes(k)));
          if (result.failed === 0) {
            showSuccessToast(toast, {
              feedbackInvocationId: createFeedbackInvocationId(),
              title: `${String(changed.length)} ${changed.length === 1 ? 'issue' : 'issues'} ${label}`,
            });
          } else {
            toast({
              title: `${String(changed.length)} updated, ${String(result.failed)} could not be changed`,
              description: result.results
                .filter((r) => !r.ok)
                .slice(0, 3)
                .map((r) => `${r.key}: ${r.message ?? r.code ?? 'failed'}`)
                .join(' · '),
              variant: 'error',
            });
          }
        },
      },
    );
  };

  const dropOnEpic = (issues: Issue[], target: string) => {
    if (target === 'all') return;
    const parentId =
      target === NONE ? null : (epics.data?.find((e) => e.key === target)?.id ?? null);
    if (target !== NONE && parentId === null) return;
    const movable = issues.filter((i) => i.type.kind !== 'subtask' && i.type.kind !== 'epic');
    if (movable.length !== issues.length) {
      toast({
        title: 'Epics hold stories, tasks and bugs',
        description: 'Sub-tasks stay under their story and epics cannot be nested.',
        variant: 'error',
      });
    }
    const [only] = movable;
    if (movable.length === 1 && only) {
      setField.mutate({
        issueKey: only.key,
        version: only.version,
        changes: { parent_id: parentId },
      });
    } else if (movable.length > 1) {
      changeMany(movable, { action: 'set_parent', parent_id: parentId }, 'moved to the epic');
    }
  };

  const dropOnVersion = (issues: Issue[], target: string) => {
    if (target === 'all') return;
    const versionId = target === NONE ? null : target;
    const [only] = issues;
    if (issues.length === 1 && only) {
      setField.mutate({
        issueKey: only.key,
        version: only.version,
        changes: { fix_version_id: versionId },
      });
    } else {
      changeMany(issues, { action: 'set_fix_version', fix_version_id: versionId }, 'updated');
    }
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    const issue = allIssues.find((i) => i.key === String(active.id));
    if (!issue || !over || !online) return;
    const overId = String(over.id);
    const dragged =
      selectedSet.has(issue.key) && selected.length > 1
        ? allIssues.filter((i) => selectedSet.has(i.key))
        : [issue];
    if (overId.startsWith('epic:')) {
      dropOnEpic(dragged, overId.slice('epic:'.length));
      return;
    }
    if (overId.startsWith('version:')) {
      dropOnVersion(dragged, overId.slice('version:'.length));
      return;
    }
    const sprintId = overId === BACKLOG_ID ? null : overId;
    if (dragged.length > 1) {
      changeMany(dragged, { action: 'move_sprint', sprint_id: sprintId }, 'moved');
      return;
    }
    moveIssue(issue, sprintId);
  };

  const onVersionAction = (action: VersionAction, version: Version) => {
    if (action === 'edit' || action === 'release' || action === 'delete') {
      setVersionDialog({ kind: action, version });
      return;
    }
    versionAction.mutate(
      { id: version.id, action },
      {
        onSuccess: () => {
          showSuccessToast(toast, {
            feedbackInvocationId: createFeedbackInvocationId(),
            title: `${version.name} ${action === 'unrelease' ? 'is unreleased again' : action === 'archive' ? 'archived' : 'unarchived'}`,
          });
        },
      },
    );
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
  const closeVersionDialog = () => {
    setVersionDialog(null);
  };

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
              setParam('q', event.target.value);
            }}
          />
        </label>
        <Button
          variant={panel === 'epics' ? 'primary' : 'secondary'}
          size="sm"
          aria-pressed={panel === 'epics'}
          aria-keyshortcuts="E"
          title="Epics (E)"
          onClick={() => {
            setPanel(panel === 'epics' ? null : 'epics');
          }}
        >
          Epics
        </Button>
        <Button
          variant={panel === 'versions' ? 'primary' : 'secondary'}
          size="sm"
          aria-pressed={panel === 'versions'}
          aria-keyshortcuts="V"
          title="Versions (V)"
          onClick={() => {
            setPanel(panel === 'versions' ? null : 'versions');
          }}
        >
          Versions
        </Button>
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
            : setField.error
              ? mutationErrorMessage(setField.error, 'issue-mutation')
              : null}
      </FormError>

      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className={panel ? 'grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]' : ''}>
          {panel ? (
            <aside
              aria-label={panel === 'epics' ? 'Epics panel' : 'Versions panel'}
              className="space-y-2 rounded-lg border border-line bg-surface p-3 lg:self-start"
            >
              {panel === 'epics' ? (
                <EpicsPanel
                  org={org}
                  project={key}
                  selected={epicFilter}
                  onSelect={(value) => {
                    setParam('epic', value);
                  }}
                  includeDone={includeDone}
                  onIncludeDone={setIncludeDone}
                  canCreate={canCreate && online}
                  onCreateEpic={() => {
                    setCreatingEpic(true);
                  }}
                />
              ) : (
                <VersionsPanel
                  org={org}
                  project={key}
                  selected={versionFilter}
                  onSelect={(value) => {
                    setParam('version', value);
                  }}
                  includeArchived={includeArchived}
                  onIncludeArchived={setIncludeArchived}
                  canManage={canManageVersions}
                  online={online}
                  onCreate={() => {
                    setVersionDialog({ kind: 'create' });
                  }}
                  onAction={onVersionAction}
                />
              )}
            </aside>
          ) : null}
          <div className="min-w-0 space-y-4">
            {filtering && shownTotal === 0 && totalIssues > 0 ? (
              <UxSearchEmpty
                query={query}
                scope="issues"
                filtersActive={Boolean(epicFilter || versionFilter)}
                onClearQuery={() => {
                  setParam('q', '');
                }}
                onClearFilters={() => {
                  const next = new URLSearchParams(search);
                  next.delete('epic');
                  next.delete('version');
                  setSearch(next, { replace: true });
                }}
              />
            ) : (
              panels.map((p) => (
                <BacklogPanel
                  key={p.id}
                  panelId={p.id}
                  title={p.title}
                  sprint={p.sprint}
                  issues={p.shown}
                  totalInPanel={p.all.length}
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
                  filtering={filtering}
                />
              ))
            )}
            {loaded.truncated ? (
              <p className="text-sm text-fg-muted">Showing the first 500 issues.</p>
            ) : null}
          </div>
        </div>
      </DndContext>

      {selected.length > 0 && (canPlan || permissions.includes('issue.edit')) ? (
        <BulkBar
          org={org}
          project={key}
          keys={selected}
          targets={targets}
          permissions={permissions}
          online={online}
          onClear={() => {
            setSelected([]);
            anchor.current = null;
          }}
          onDone={(changed) => {
            setSelected((current) => current.filter((k) => !changed.includes(k)));
          }}
        />
      ) : null}

      {creatingEpic ? (
        <CreateIssueDialog
          org={org}
          project={key}
          defaultKind="epic"
          onClose={() => {
            setCreatingEpic(false);
          }}
        />
      ) : null}

      {versionDialog?.kind === 'create' ? (
        <VersionFormDialog org={org} project={key} online={online} onClose={closeVersionDialog} />
      ) : null}
      {versionDialog?.kind === 'edit' ? (
        <VersionFormDialog
          org={org}
          project={key}
          online={online}
          version={versionDialog.version}
          onClose={closeVersionDialog}
        />
      ) : null}
      {versionDialog?.kind === 'release' ? (
        <ReleaseVersionDialog
          org={org}
          project={key}
          online={online}
          version={versionDialog.version}
          others={otherVersions}
          onClose={closeVersionDialog}
        />
      ) : null}
      {versionDialog?.kind === 'delete' ? (
        <DeleteVersionDialog
          org={org}
          project={key}
          online={online}
          version={versionDialog.version}
          others={otherVersions}
          onClose={closeVersionDialog}
        />
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
