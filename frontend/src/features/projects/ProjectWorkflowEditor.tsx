import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ArrowDown, ArrowUp, GripVertical, Plus, Trash2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useId, useMemo, useState, type ReactNode } from 'react';

import { apiFetch } from '../../lib/api/client';
import { boardKey } from '../board/api';

import { useAppOnline } from '../../app/OnlineStatusProvider';
import { Badge } from '../../components/ui/Badge';
import { Button, IconButton } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { FormError } from '../../components/ui/Form';
import { Input } from '../../components/ui/Input';
import { useToast } from '../../components/ui/Toast';
import { ApiError } from '../../lib/api/errors';
import type { Board, Workflow } from '../../lib/api/types';
import { describeError } from '../../lib/forms';
import { permissionDeniedInlineMessage } from '../../lib/ux/permissionDenied';

import { useUnsavedChangesWarning } from '../../hooks/useUnsavedChangesWarning';

import { projectKey as projectQueryKey, useReplaceWorkflow } from './api';
import { assignStatus, MAX_COLUMNS, moveColumn } from './boardColumnsModel';
import {
  addStatus,
  addTransition,
  applyStatusRemapToDraft,
  cloneDraft,
  editorHasErrors,
  fromServer,
  isDirty,
  nextColumnClientKey,
  removeStatusFromDraft,
  toReplaceWorkflowRequest,
  validateDraft,
  type StatusCategory,
  type WorkflowDraft,
} from './workflowEditorModel';

function SortableStatusRow({
  id,
  disabled,
  children,
}: {
  id: string;
  disabled: boolean;
  children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled,
  });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex flex-wrap items-start gap-2 rounded-lg border border-line bg-surface p-3 ${isDragging ? 'z-10 shadow-lg' : ''}`}
    >
      <button
        type="button"
        disabled={disabled}
        aria-label="Drag to reorder status"
        className="flex h-8 w-6 cursor-grab touch-none items-center justify-center rounded text-fg-muted hover:text-fg disabled:opacity-50"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-4" aria-hidden />
      </button>
      {children}
    </li>
  );
}

export function ProjectWorkflowEditor({
  org,
  projectKey,
  projectName,
  workflow,
  board,
  archived,
}: {
  org: string;
  projectKey: string;
  projectName: string;
  workflow: Workflow;
  board: Board;
  archived: boolean;
}) {
  const formId = useId();
  const online = useAppOnline();
  const toast = useToast();
  const queryClient = useQueryClient();
  const save = useReplaceWorkflow(org, projectKey);

  const boot = useMemo(() => fromServer(workflow, board), [workflow, board]);
  const [baselineRevision, setBaselineRevision] = useState(workflow.revision);
  const [draft, setDraft] = useState<WorkflowDraft | null>(boot.ok ? cloneDraft(boot.draft) : null);
  const [baseline, setBaseline] = useState<WorkflowDraft | null>(
    boot.ok ? cloneDraft(boot.draft) : null,
  );
  const [submitted, setSubmitted] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [statusInUseIds, setStatusInUseIds] = useState<string[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleteRemapTo, setDeleteRemapTo] = useState('');

  useEffect(() => {
    const next = fromServer(workflow, board);
    if (!next.ok) return;
    const cloned = cloneDraft(next.draft);
    /* eslint-disable react-hooks/set-state-in-effect -- preserve dirty draft when server props refresh */
    setBaseline(cloned);
    setBaselineRevision(workflow.revision);
    setDraft((current) => {
      if (current && isDirty(current, cloned)) return current;
      return cloneDraft(cloned);
    });
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [workflow, board]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const errors = draft ? validateDraft(draft) : null;
  const dirty = draft && baseline ? isDirty(draft, baseline) : false;
  const disabled = archived || !online || save.isPending;
  useUnsavedChangesWarning(dirty && !archived);

  const failure =
    save.error && !(save.error instanceof ApiError && save.error.status === 412)
      ? (permissionDeniedInlineMessage(save.error, 'project-settings') ?? describeError(save.error))
      : null;

  const onSave = useCallback(() => {
    if (!draft) return;
    setSubmitted(true);
    setStatusInUseIds([]);
    const v = validateDraft(draft);
    if (editorHasErrors(v)) return;
    save.mutate(
      { body: toReplaceWorkflowRequest(draft), revision: baselineRevision },
      {
        onSuccess: (data) => {
          void (async () => {
            setSubmitted(false);
            setConflict(false);
            setBaselineRevision(data.revision);
            // eslint-disable-next-line @typescript-eslint/no-deprecated -- until query() migration
            const freshBoard = await queryClient.fetchQuery({
              queryKey: boardKey(org, projectKey),
              queryFn: () =>
                apiFetch<Board>(
                  `/orgs/${encodeURIComponent(org)}/projects/${encodeURIComponent(projectKey)}/board`,
                ),
            });
            const refreshed = fromServer(data, freshBoard);
            if (refreshed.ok) {
              const b = cloneDraft(refreshed.draft);
              setBaseline(b);
              setDraft(cloneDraft(b));
            }
            toast({ title: 'Workflow saved' });
          })();
        },
        onError: (err) => {
          if (err instanceof ApiError && err.status === 412) {
            setConflict(true);
            return;
          }
          if (err instanceof ApiError && err.code === 'status_in_use') {
            const pending = draft.removedStatusIds.filter(
              (id) => !draft.statusRemaps.some((r) => r.from_status_id === id && r.to_status_id),
            );
            setStatusInUseIds(pending.length > 0 ? pending : draft.removedStatusIds);
          }
        },
      },
    );
  }, [draft, save, baselineRevision, org, projectKey, queryClient, toast]);

  const reloadLatest = useCallback(async () => {
    setConflict(false);
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- until query() migration
    const freshWorkflow = await queryClient.fetchQuery({
      queryKey: [...projectQueryKey(org, projectKey), 'workflow'],
      queryFn: () =>
        apiFetch<Workflow>(
          `/orgs/${encodeURIComponent(org)}/projects/${encodeURIComponent(projectKey)}/workflow`,
        ),
    });
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- until query() migration
    const freshBoard = await queryClient.fetchQuery({
      queryKey: boardKey(org, projectKey),
      queryFn: () =>
        apiFetch<Board>(
          `/orgs/${encodeURIComponent(org)}/projects/${encodeURIComponent(projectKey)}/board`,
        ),
    });
    const next = fromServer(freshWorkflow, freshBoard);
    if (next.ok) {
      setBaseline(cloneDraft(next.draft));
      setBaselineRevision(freshWorkflow.revision);
    }
  }, [org, projectKey, queryClient]);

  const discard = useCallback(() => {
    if (baseline) setDraft(cloneDraft(baseline));
    setSubmitted(false);
    setConflict(false);
    setStatusInUseIds([]);
    save.reset();
  }, [baseline, save]);

  if (!boot.ok || !draft || !baseline) {
    return (
      <Card className="p-5 sm:p-6">
        <FormError>{boot.ok ? 'Loading…' : boot.error}</FormError>
      </Card>
    );
  }

  const statusName = new Map(draft.statuses.map((s) => [s.id, s.name]));

  const onStatusDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    setDraft((d) => {
      if (!d) return d;
      const from = d.statuses.findIndex((s) => s.clientKey === active.id);
      const to = d.statuses.findIndex((s) => s.clientKey === over.id);
      if (from < 0 || to < 0) return d;
      return { ...d, statuses: arrayMove(d.statuses, from, to) };
    });
  };

  const onColumnDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    setDraft((d) => {
      if (!d) return d;
      const from = d.columns.findIndex((c) => c.uid === active.id);
      const to = d.columns.findIndex((c) => c.uid === over.id);
      if (from < 0 || to < 0) return d;
      return { ...d, columns: arrayMove(d.columns, from, to) };
    });
  };

  const applyRemapsForStatusInUse = () => {
    setDraft((d) => {
      if (!d) return d;
      let next = d;
      for (const fromId of statusInUseIds) {
        const entry = next.statusRemaps.find((r) => r.from_status_id === fromId);
        if (entry) next = applyStatusRemapToDraft(next, fromId, entry.to_status_id);
      }
      return next;
    });
    setStatusInUseIds([]);
  };

  return (
    <Card className="space-y-5 p-5 sm:p-6" aria-labelledby={`${formId}-title`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <label htmlFor={`${formId}-name`} className="text-xs font-medium text-fg-muted">
            Workflow name
          </label>
          <Input
            id={`${formId}-name`}
            value={draft.name}
            maxLength={100}
            disabled={disabled}
            aria-invalid={Boolean(errors?.workflowName)}
            onChange={(e) => {
              setDraft({ ...draft, name: e.target.value });
            }}
          />
          {errors?.workflowName ? (
            <p className="text-xs text-danger">{errors.workflowName}</p>
          ) : null}
          <p className="text-sm text-fg-muted">
            {projectKey} · {projectName} · revision w{baselineRevision}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" size="sm" disabled={!dirty || save.isPending} onClick={discard}>
            Discard
          </Button>
          <Button variant="primary" size="sm" disabled={disabled || !dirty} onClick={onSave}>
            {save.isPending ? 'Saving…' : 'Save workflow'}
          </Button>
        </div>
      </div>

      {archived ? <p className="text-sm text-fg-muted">Archived projects are read-only.</p> : null}
      {!online ? (
        <p role="status" className="text-sm text-warning">
          You are offline. Changes stay in this tab until you reconnect.
        </p>
      ) : null}

      {conflict ? (
        <div
          role="alert"
          className="rounded-lg border border-warning/50 bg-warning/10 p-3 text-sm text-fg"
        >
          Someone else updated this workflow. Your changes were not saved; your draft is kept below.{' '}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="ml-2"
            onClick={() => {
              void reloadLatest();
            }}
          >
            Reload latest version
          </Button>
          <Button type="button" variant="ghost" size="sm" className="ml-1" onClick={discard}>
            Discard my changes
          </Button>
        </div>
      ) : null}

      {statusInUseIds.length > 0 ? (
        <div role="alert" className="space-y-2 rounded-lg border border-warning/50 p-3">
          <p className="text-sm font-medium text-fg">Issues still use a removed status</p>
          <p className="text-sm text-fg-muted">
            Choose where to move those issues, update the draft, then save again.
          </p>
          <ul className="space-y-2">
            {statusInUseIds.map((fromId) => (
              <li key={fromId} className="flex flex-wrap items-center gap-2">
                <span className="text-sm">{statusName.get(fromId) ?? fromId}</span>
                <select
                  aria-label={`Replacement status for ${statusName.get(fromId) ?? fromId}`}
                  className="h-8 rounded-md border border-line-strong bg-surface px-2 text-sm"
                  value={
                    draft.statusRemaps.find((r) => r.from_status_id === fromId)?.to_status_id ?? ''
                  }
                  onChange={(e) => {
                    if (!e.target.value) return;
                    setDraft((d) => (d ? applyStatusRemapToDraft(d, fromId, e.target.value) : d));
                  }}
                >
                  <option value="">Move issues to…</option>
                  {draft.statuses.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
          <Button type="button" size="sm" variant="secondary" onClick={applyRemapsForStatusInUse}>
            Apply remapping to draft
          </Button>
        </div>
      ) : null}

      <FormError>{submitted && errors?.form ? errors.form : null}</FormError>
      <FormError>{failure}</FormError>

      <section aria-labelledby={`${formId}-statuses`}>
        <h3
          id={`${formId}-statuses`}
          className="text-xs font-semibold uppercase tracking-wide text-fg-muted"
        >
          Statuses
        </h3>
        {errors?.initialStatus ? (
          <p className="mt-1 text-xs text-danger">{errors.initialStatus}</p>
        ) : null}
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onStatusDragEnd}
        >
          <SortableContext
            items={draft.statuses.map((s) => s.clientKey)}
            strategy={verticalListSortingStrategy}
          >
            <ul className="mt-2 space-y-2">
              {draft.statuses.map((s) => (
                <SortableStatusRow key={s.clientKey} id={s.clientKey} disabled={disabled}>
                  <Input
                    aria-label="Status name"
                    value={s.name}
                    maxLength={100}
                    disabled={disabled}
                    className="min-w-32 flex-1"
                    onChange={(e) => {
                      setDraft({
                        ...draft,
                        statuses: draft.statuses.map((row) =>
                          row.clientKey === s.clientKey ? { ...row, name: e.target.value } : row,
                        ),
                      });
                    }}
                  />
                  <select
                    aria-label="Category"
                    disabled={disabled}
                    className="h-9 rounded-md border border-line-strong bg-surface px-2 text-sm"
                    value={s.category}
                    onChange={(e) => {
                      setDraft({
                        ...draft,
                        statuses: draft.statuses.map((row) =>
                          row.clientKey === s.clientKey
                            ? { ...row, category: e.target.value as StatusCategory }
                            : row,
                        ),
                      });
                    }}
                  >
                    <option value="todo">To do</option>
                    <option value="in_progress">In progress</option>
                    <option value="done">Done</option>
                  </select>
                  <label className="flex items-center gap-1 text-sm">
                    <input
                      type="radio"
                      name={`${formId}-initial`}
                      disabled={disabled}
                      checked={draft.initialStatusId === s.id}
                      onChange={() => {
                        setDraft({ ...draft, initialStatusId: s.id });
                      }}
                    />
                    Initial
                  </label>
                  {errors?.statusNames[s.clientKey] ? (
                    <span className="text-xs text-danger">{errors.statusNames[s.clientKey]}</span>
                  ) : null}
                  <IconButton
                    label={`Delete status ${s.name || 'unnamed'}`}
                    size="sm"
                    disabled={disabled || draft.statuses.length <= 1}
                    onClick={() => {
                      setDeleteTarget(s.id);
                      setDeleteRemapTo('');
                    }}
                  >
                    <Trash2 className="size-4" />
                  </IconButton>
                </SortableStatusRow>
              ))}
            </ul>
          </SortableContext>
        </DndContext>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="mt-2"
          disabled={disabled}
          onClick={() => {
            setDraft(addStatus(draft));
          }}
        >
          <Plus className="size-4" /> Add status
        </Button>
      </section>

      {deleteTarget ? (
        <div className="rounded-lg border border-line p-3" role="dialog" aria-modal="true">
          <p className="text-sm font-medium">Delete status {statusName.get(deleteTarget)}?</p>
          <p className="mt-1 text-sm text-fg-muted">
            If issues use this status, pick a replacement before saving (optional now).
          </p>
          <select
            className="mt-2 h-9 w-full max-w-xs rounded-md border border-line-strong bg-surface px-2 text-sm"
            value={deleteRemapTo}
            onChange={(e) => {
              setDeleteRemapTo(e.target.value);
            }}
          >
            <option value="">Move issues to (if any)…</option>
            {draft.statuses
              .filter((s) => s.id !== deleteTarget)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </select>
          <div className="mt-3 flex gap-2">
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={() => {
                let next = removeStatusFromDraft(draft, deleteTarget);
                if (deleteRemapTo) {
                  next = applyStatusRemapToDraft(next, deleteTarget, deleteRemapTo);
                }
                setDraft(next);
                setDeleteTarget(null);
              }}
            >
              Remove from draft
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setDeleteTarget(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      <section aria-labelledby={`${formId}-transitions`}>
        <h3
          id={`${formId}-transitions`}
          className="text-xs font-semibold uppercase tracking-wide text-fg-muted"
        >
          Transitions
        </h3>
        <ul className="mt-2 space-y-2">
          {draft.transitions.map((t) => (
            <li
              key={t.clientKey}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-line p-2"
            >
              <Input
                aria-label="Transition name"
                value={t.name}
                disabled={disabled}
                className="min-w-28 flex-1"
                onChange={(e) => {
                  setDraft({
                    ...draft,
                    transitions: draft.transitions.map((row) =>
                      row.clientKey === t.clientKey ? { ...row, name: e.target.value } : row,
                    ),
                  });
                }}
              />
              <select
                aria-label="From status"
                disabled={disabled}
                className="h-9 rounded-md border border-line-strong px-2 text-sm"
                value={t.from_status_id ?? ''}
                onChange={(e) => {
                  setDraft({
                    ...draft,
                    transitions: draft.transitions.map((row) =>
                      row.clientKey === t.clientKey
                        ? {
                            ...row,
                            from_status_id: e.target.value === '' ? null : e.target.value,
                          }
                        : row,
                    ),
                  });
                }}
              >
                <option value="">Any status</option>
                {draft.statuses.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <span className="text-fg-muted">→</span>
              <select
                aria-label="To status"
                disabled={disabled}
                className="h-9 rounded-md border border-line-strong px-2 text-sm"
                value={t.to_status_id}
                onChange={(e) => {
                  setDraft({
                    ...draft,
                    transitions: draft.transitions.map((row) =>
                      row.clientKey === t.clientKey
                        ? { ...row, to_status_id: e.target.value }
                        : row,
                    ),
                  });
                }}
              >
                {draft.statuses.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <IconButton
                label="Delete transition"
                size="sm"
                disabled={disabled}
                onClick={() => {
                  setDraft({
                    ...draft,
                    transitions: draft.transitions.filter((row) => row.clientKey !== t.clientKey),
                  });
                }}
              >
                <Trash2 className="size-4" />
              </IconButton>
            </li>
          ))}
        </ul>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="mt-2"
          disabled={disabled || draft.statuses.length === 0}
          onClick={() => {
            setDraft(addTransition(draft));
          }}
        >
          <Plus className="size-4" /> Add transition
        </Button>
      </section>

      <section aria-labelledby={`${formId}-columns`}>
        <h3
          id={`${formId}-columns`}
          className="text-xs font-semibold uppercase tracking-wide text-fg-muted"
        >
          Board columns
        </h3>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onColumnDragEnd}
        >
          <SortableContext
            items={draft.columns.map((c) => c.uid)}
            strategy={verticalListSortingStrategy}
          >
            <ol className="mt-2 space-y-2">
              {draft.columns.map((column, index) => (
                <li
                  key={column.uid}
                  className="space-y-2 rounded-lg border border-line bg-surface p-3"
                >
                  <div className="flex flex-wrap items-end gap-2">
                    <Input
                      aria-label="Column name"
                      value={column.name}
                      disabled={disabled}
                      className="min-w-32 flex-1"
                      onChange={(e) => {
                        setDraft({
                          ...draft,
                          columns: draft.columns.map((c) =>
                            c.uid === column.uid ? { ...c, name: e.target.value } : c,
                          ),
                        });
                      }}
                    />
                    <Input
                      aria-label="WIP limit"
                      placeholder="None"
                      value={column.wip}
                      disabled={disabled}
                      className="w-24"
                      onChange={(e) => {
                        setDraft({
                          ...draft,
                          columns: draft.columns.map((c) =>
                            c.uid === column.uid ? { ...c, wip: e.target.value } : c,
                          ),
                        });
                      }}
                    />
                    <IconButton
                      label="Move column up"
                      size="sm"
                      disabled={disabled || index === 0}
                      onClick={() => {
                        setDraft({ ...draft, columns: moveColumn(draft.columns, index, -1) });
                      }}
                    >
                      <ArrowUp className="size-4" />
                    </IconButton>
                    <IconButton
                      label="Move column down"
                      size="sm"
                      disabled={disabled || index === draft.columns.length - 1}
                      onClick={() => {
                        setDraft({ ...draft, columns: moveColumn(draft.columns, index, 1) });
                      }}
                    >
                      <ArrowDown className="size-4" />
                    </IconButton>
                    <IconButton
                      label="Remove column"
                      size="sm"
                      disabled={disabled || column.statusIds.length > 0}
                      onClick={() => {
                        setDraft({
                          ...draft,
                          columns: draft.columns.filter((c) => c.uid !== column.uid),
                        });
                      }}
                    >
                      <Trash2 className="size-4" />
                    </IconButton>
                  </div>
                  <ul className="flex flex-wrap gap-2">
                    {column.statusIds.map((sid) => (
                      <li key={sid} className="flex items-center gap-1">
                        <Badge tone="neutral">{statusName.get(sid) ?? sid}</Badge>
                        <select
                          aria-label={`Column for ${statusName.get(sid) ?? sid}`}
                          className="h-7 rounded-md border px-1 text-xs"
                          value={column.uid}
                          disabled={disabled}
                          onChange={(e) => {
                            setDraft({
                              ...draft,
                              columns: assignStatus(draft.columns, sid, e.target.value),
                            });
                          }}
                        >
                          {draft.columns.map((c, i) => (
                            <option key={c.uid} value={c.uid}>
                              {c.name || `Column ${String(i + 1)}`}
                            </option>
                          ))}
                        </select>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          </SortableContext>
        </DndContext>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="mt-2"
          disabled={disabled || draft.columns.length >= MAX_COLUMNS}
          onClick={() => {
            setDraft({
              ...draft,
              columns: [
                ...draft.columns,
                { uid: nextColumnClientKey(), name: '', wip: '', statusIds: [] },
              ],
            });
          }}
        >
          <Plus className="size-4" /> Add column
        </Button>
      </section>
    </Card>
  );
}
