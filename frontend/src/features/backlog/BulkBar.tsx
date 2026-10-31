import { useState } from 'react';

import { Button } from '../../components/ui/Button';
import { Dialog, DialogContent } from '../../components/ui/Overlay';
import { useToast } from '../../components/ui/Toast';
import type { BulkResult } from '../../lib/api/types';
import { createFeedbackInvocationId, showSuccessToast } from '../../lib/ux/mutationFeedback';
import { mutationErrorMessage } from '../../lib/ux/permissionDenied';
import { usePriorities } from '../issues/api';
import { useProjectMembers } from '../projects/api';

import type { MoveTarget } from './BacklogRow';
import { type BulkAction, useBulkChange, useEpics, useVersions } from './planApi';

type Kind = 'move' | 'assign' | 'priority' | 'epic' | 'version' | 'delete';

const NONE_VALUE = '__none__';

/** Floating bar for a multi-selection: one action for all selected issues in one request.
 * The server checks every issue on its own, so the result can be partial; the toast says how
 * many changed and which did not. Delete asks for confirmation first. */
export function BulkBar({
  org,
  project,
  keys,
  targets,
  permissions,
  online,
  onClear,
  onDone,
}: {
  org: string;
  project: string;
  keys: string[];
  targets: MoveTarget[];
  permissions: readonly string[];
  online: boolean;
  onClear: () => void;
  /** Called with the keys that changed, so they can be dropped from the selection. */
  onDone: (changed: string[]) => void;
}) {
  const bulk = useBulkChange(org, project);
  const toast = useToast();
  const members = useProjectMembers(org, project);
  const priorities = usePriorities(org);
  const epics = useEpics(org, project, false);
  const versions = useVersions(org, project, false);
  const can = (permission: string) => permissions.includes(permission);

  const kinds: { kind: Kind; label: string }[] = [
    ...(can('sprint.manage') ? [{ kind: 'move' as const, label: 'Move to sprint' }] : []),
    ...(can('issue.assign') ? [{ kind: 'assign' as const, label: 'Assign to' }] : []),
    ...(can('issue.edit')
      ? [
          { kind: 'priority' as const, label: 'Set priority' },
          { kind: 'epic' as const, label: 'Set epic' },
        ]
      : []),
    ...(can('issue.edit') ? [{ kind: 'version' as const, label: 'Set fix version' }] : []),
    ...(can('issue.delete') ? [{ kind: 'delete' as const, label: 'Delete' }] : []),
  ];
  const [kind, setKind] = useState<Kind>(kinds[0]?.kind ?? 'delete');
  const [value, setValue] = useState('');
  const [confirming, setConfirming] = useState(false);

  const options: { value: string; label: string }[] =
    kind === 'move'
      ? targets.map((t) => ({ value: t.id, label: t.label }))
      : kind === 'assign'
        ? [
            { value: NONE_VALUE, label: 'Unassigned' },
            ...(members.data ?? []).map((m) => ({ value: m.user_id, label: m.display_name })),
          ]
        : kind === 'priority'
          ? (priorities.data ?? []).map((p) => ({ value: p.id, label: p.name }))
          : kind === 'epic'
            ? [
                { value: NONE_VALUE, label: 'No epic' },
                ...(epics.data ?? []).map((e) => ({ value: e.id, label: `${e.key} ${e.summary}` })),
              ]
            : kind === 'version'
              ? [
                  { value: NONE_VALUE, label: 'No version' },
                  ...(versions.data ?? [])
                    .filter((v) => v.status !== 'archived')
                    .map((v) => ({ value: v.id, label: v.name })),
                ]
              : [];
  const chosen = value || options[0]?.value || '';
  const orNull = (v: string) => (v === NONE_VALUE ? null : v);

  const build = (): BulkAction | null => {
    switch (kind) {
      case 'move':
        return { action: 'move_sprint', sprint_id: chosen === 'backlog' ? null : chosen };
      case 'assign':
        return { action: 'assign', assignee_id: orNull(chosen) };
      case 'priority':
        return chosen ? { action: 'set_priority', priority_id: chosen } : null;
      case 'epic':
        return { action: 'set_parent', parent_id: orNull(chosen) };
      case 'version':
        return { action: 'set_fix_version', fix_version_id: orNull(chosen) };
      case 'delete':
        return { action: 'delete' };
    }
  };

  const report = (result: BulkResult) => {
    const changed = result.results.filter((r) => r.ok).map((r) => r.key);
    const failures = result.results.filter((r) => !r.ok);
    onDone(changed);
    if (failures.length === 0) {
      showSuccessToast(toast, {
        feedbackInvocationId: createFeedbackInvocationId(),
        title: `${String(changed.length)} ${changed.length === 1 ? 'issue' : 'issues'} updated`,
      });
      return;
    }
    toast({
      title: `${String(changed.length)} updated, ${String(failures.length)} could not be changed`,
      description: failures
        .slice(0, 3)
        .map((f) => `${f.key}: ${f.message ?? f.code ?? 'failed'}`)
        .join(' · '),
      variant: 'error',
    });
  };

  const apply = () => {
    const change = build();
    if (!change || !online || bulk.isPending) return;
    bulk.mutate({ keys, change }, { onSuccess: report });
  };

  return (
    <>
      <div
        role="region"
        aria-label="Bulk actions"
        className="fixed bottom-4 left-1/2 z-40 flex max-w-[95vw] -translate-x-1/2 flex-wrap items-center gap-3 rounded-lg border border-line bg-surface px-4 py-2 shadow-lg"
      >
        <span className="text-sm font-medium">{keys.length} selected</span>
        <label className="flex items-center gap-2 text-sm">
          Action
          <select
            className="h-8 rounded-md border border-line-strong bg-surface px-2"
            value={kind}
            onChange={(event) => {
              setKind(event.target.value as Kind);
              setValue('');
            }}
          >
            {kinds.map((k) => (
              <option key={k.kind} value={k.kind}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        {kind !== 'delete' ? (
          <label className="flex items-center gap-2 text-sm">
            <span className="sr-only">Value</span>
            <select
              aria-label="Value"
              className="h-8 max-w-56 rounded-md border border-line-strong bg-surface px-2"
              value={chosen}
              onChange={(event) => {
                setValue(event.target.value);
              }}
            >
              {options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <Button
          variant={kind === 'delete' ? 'danger' : 'primary'}
          size="sm"
          disabled={!online || bulk.isPending || kinds.length === 0}
          aria-busy={bulk.isPending}
          onClick={() => {
            if (kind === 'delete') setConfirming(true);
            else apply();
          }}
        >
          {kind === 'delete' ? 'Delete…' : 'Apply'}
        </Button>
        <Button variant="ghost" size="sm" onClick={onClear}>
          Clear selection
        </Button>
        {bulk.error ? (
          <p role="alert" className="basis-full text-xs text-danger">
            {mutationErrorMessage(bulk.error, 'issue-mutation')}
          </p>
        ) : null}
        {!online ? (
          <p role="status" className="basis-full text-xs text-warning">
            You are offline. Reconnect to change issues.
          </p>
        ) : null}
      </div>
      {confirming ? (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setConfirming(false);
          }}
        >
          <DialogContent
            title={`Delete ${String(keys.length)} ${keys.length === 1 ? 'issue' : 'issues'}?`}
            description="Deleted issues leave the backlog and boards. Sub-tasks go with their story; an epic's issues are detached."
          >
            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="ghost"
                onClick={() => {
                  setConfirming(false);
                }}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                disabled={!online || bulk.isPending}
                onClick={() => {
                  setConfirming(false);
                  apply();
                }}
              >
                Delete
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}
