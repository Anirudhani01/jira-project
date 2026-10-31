import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useId, useMemo, useState } from 'react';

import { useAppOnline } from '../../app/OnlineStatusProvider';
import { Badge } from '../../components/ui/Badge';
import { Button, IconButton } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { FormError } from '../../components/ui/Form';
import { Input } from '../../components/ui/Input';
import { useToast } from '../../components/ui/Toast';
import type { Board, Workflow } from '../../lib/api/types';
import { describeError } from '../../lib/forms';
import { permissionDeniedInlineMessage } from '../../lib/ux/permissionDenied';

import { useReplaceBoardColumns } from './api';
import {
  assignStatus,
  hasErrors,
  MAX_COLUMNS,
  moveColumn,
  toRequest,
  validateColumns,
  type ColumnDraft,
} from './boardColumnsModel';

let counter = 0;
const nextUid = () => `new-${String((counter += 1))}`;

function fromBoard(board: Board): ColumnDraft[] {
  return board.columns.map((c) => ({
    id: c.id,
    uid: c.id,
    name: c.name,
    wip: c.wip_limit === null ? '' : String(c.wip_limit),
    statusIds: [...c.status_ids],
  }));
}

const sameDrafts = (a: ColumnDraft[], b: ColumnDraft[]) => JSON.stringify(a) === JSON.stringify(b);

/** Edits column names, order, WIP limits and which statuses each column holds. */
export function BoardColumnsEditor({
  org,
  project,
  board,
  workflow,
  canManage,
}: {
  org: string;
  project: string;
  board: Board;
  workflow: Workflow;
  canManage: boolean;
}) {
  const initial = useMemo(() => fromBoard(board), [board]);
  const [draft, setDraft] = useState<ColumnDraft[]>(initial);
  const [submitted, setSubmitted] = useState(false);
  const save = useReplaceBoardColumns(org, project);
  const online = useAppOnline();
  const toast = useToast();
  const formId = useId();

  const statuses = workflow.statuses;
  const statusName = new Map(statuses.map((s) => [s.id, s.name]));
  const errors = validateColumns(
    draft,
    statuses.map((s) => s.id),
  );
  const dirty = !sameDrafts(draft, initial);
  const disabled = !canManage || !online || save.isPending;
  const failure = save.error
    ? (permissionDeniedInlineMessage(save.error, 'project-settings') ?? describeError(save.error))
    : null;

  const update = (uid: string, patch: Partial<ColumnDraft>) => {
    setDraft((rows) => rows.map((r) => (r.uid === uid ? { ...r, ...patch } : r)));
  };

  const onSave = () => {
    setSubmitted(true);
    if (hasErrors(errors)) return;
    save.mutate(toRequest(draft), {
      onSuccess: () => {
        setSubmitted(false);
        toast({ title: 'Board columns saved' });
      },
    });
  };

  const unmapped = statuses.filter((s) => errors.unmapped.includes(s.id));

  return (
    <Card className="space-y-4 p-5 sm:p-6" aria-labelledby={`${formId}-title`}>
      <div>
        <h2 id={`${formId}-title`} className="text-lg font-semibold text-fg">
          Board columns
        </h2>
        <p className="mt-1 text-sm text-fg-muted">
          Name and order the columns, set work-in-progress limits and choose which statuses each
          column holds. Every status belongs to exactly one column.
        </p>
      </div>
      {!canManage ? (
        <p className="text-sm text-fg-muted">You need permission to change the board columns.</p>
      ) : null}
      {!online ? (
        <p role="status" className="text-sm text-warning">
          You are offline. Changes are kept here but cannot be saved until you reconnect.
        </p>
      ) : null}

      <ol className="space-y-3">
        {draft.map((column, index) => (
          <li key={column.uid} className="space-y-2 rounded-lg border border-line p-3">
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-40 flex-1">
                <label className="text-xs font-medium text-fg-muted" htmlFor={`${column.uid}-name`}>
                  Column {index + 1} name
                </label>
                <Input
                  id={`${column.uid}-name`}
                  value={column.name}
                  maxLength={100}
                  disabled={disabled}
                  aria-invalid={Boolean(errors.names[column.uid])}
                  aria-describedby={errors.names[column.uid] ? `${column.uid}-name-err` : undefined}
                  onChange={(e) => {
                    update(column.uid, { name: e.target.value });
                  }}
                />
                {errors.names[column.uid] ? (
                  <p id={`${column.uid}-name-err`} className="mt-1 text-xs text-danger">
                    {errors.names[column.uid]}
                  </p>
                ) : null}
              </div>
              <div className="w-28">
                <label className="text-xs font-medium text-fg-muted" htmlFor={`${column.uid}-wip`}>
                  WIP limit
                </label>
                <Input
                  id={`${column.uid}-wip`}
                  inputMode="numeric"
                  placeholder="None"
                  value={column.wip}
                  disabled={disabled}
                  aria-invalid={Boolean(errors.wip[column.uid])}
                  aria-describedby={errors.wip[column.uid] ? `${column.uid}-wip-err` : undefined}
                  onChange={(e) => {
                    update(column.uid, { wip: e.target.value });
                  }}
                />
              </div>
              <div className="flex gap-1">
                <IconButton
                  label={`Move ${column.name || `column ${String(index + 1)}`} up`}
                  size="sm"
                  disabled={disabled || index === 0}
                  onClick={() => {
                    setDraft((rows) => moveColumn(rows, index, -1));
                  }}
                >
                  <ArrowUp className="size-4" aria-hidden="true" />
                </IconButton>
                <IconButton
                  label={`Move ${column.name || `column ${String(index + 1)}`} down`}
                  size="sm"
                  disabled={disabled || index === draft.length - 1}
                  onClick={() => {
                    setDraft((rows) => moveColumn(rows, index, 1));
                  }}
                >
                  <ArrowDown className="size-4" aria-hidden="true" />
                </IconButton>
                <IconButton
                  label={`Remove ${column.name || `column ${String(index + 1)}`}`}
                  size="sm"
                  disabled={disabled || column.statusIds.length > 0}
                  title={
                    column.statusIds.length > 0
                      ? 'Move its statuses to another column first'
                      : 'Remove column'
                  }
                  onClick={() => {
                    setDraft((rows) => rows.filter((r) => r.uid !== column.uid));
                  }}
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </IconButton>
              </div>
            </div>
            {errors.wip[column.uid] ? (
              <p id={`${column.uid}-wip-err`} className="text-xs text-danger">
                {errors.wip[column.uid]}
              </p>
            ) : null}
            <ul className="flex flex-wrap gap-2" aria-label={`Statuses in ${column.name}`}>
              {column.statusIds.length === 0 ? (
                <li className="text-xs text-fg-subtle">No statuses</li>
              ) : null}
              {column.statusIds.map((statusId) => (
                <li key={statusId} className="flex items-center gap-1">
                  <Badge tone="neutral">{statusName.get(statusId) ?? statusId}</Badge>
                  <select
                    aria-label={`Column for ${statusName.get(statusId) ?? statusId}`}
                    className="h-7 rounded-md border border-line-strong bg-surface px-1 text-xs text-fg"
                    value={column.uid}
                    disabled={disabled}
                    onChange={(e) => {
                      setDraft((rows) => assignStatus(rows, statusId, e.target.value));
                    }}
                  >
                    {draft.map((c, i) => (
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

      {unmapped.length > 0 ? (
        <div className="space-y-2 rounded-lg border border-warning/50 p-3">
          <p className="text-sm font-medium text-fg">Statuses without a column</p>
          <ul className="flex flex-wrap gap-2">
            {unmapped.map((s) => (
              <li key={s.id} className="flex items-center gap-1">
                <Badge tone="warning">{s.name}</Badge>
                <select
                  aria-label={`Column for ${s.name}`}
                  className="h-7 rounded-md border border-line-strong bg-surface px-1 text-xs text-fg"
                  value=""
                  disabled={disabled}
                  onChange={(e) => {
                    if (e.target.value)
                      setDraft((rows) => assignStatus(rows, s.id, e.target.value));
                  }}
                >
                  <option value="">Choose a column…</option>
                  {draft.map((c, i) => (
                    <option key={c.uid} value={c.uid}>
                      {c.name || `Column ${String(i + 1)}`}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {submitted && errors.form ? <FormError>{errors.form}</FormError> : null}
      <FormError>{failure}</FormError>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          size="sm"
          disabled={disabled || draft.length >= MAX_COLUMNS}
          onClick={() => {
            setDraft((rows) => [...rows, { uid: nextUid(), name: '', wip: '', statusIds: [] }]);
          }}
        >
          <Plus className="size-4" aria-hidden="true" />
          Add column
        </Button>
        <Button variant="primary" size="sm" disabled={disabled || !dirty} onClick={onSave}>
          {save.isPending ? 'Saving…' : 'Save columns'}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={!dirty || save.isPending}
          onClick={() => {
            setDraft(initial);
            setSubmitted(false);
            save.reset();
          }}
        >
          Discard changes
        </Button>
      </div>
    </Card>
  );
}
