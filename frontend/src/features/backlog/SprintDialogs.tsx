import { useState, type SyntheticEvent } from 'react';

import { Button } from '../../components/ui/Button';
import { FormError } from '../../components/ui/Form';
import { Field, Input, Textarea } from '../../components/ui/Input';
import { Dialog, DialogContent } from '../../components/ui/Overlay';
import { useToast } from '../../components/ui/Toast';
import type { Sprint } from '../../lib/api/types';
import { createFeedbackInvocationId, showSuccessToast } from '../../lib/ux/mutationFeedback';
import { mutationErrorMessage } from '../../lib/ux/permissionDenied';

import { defaultSprintDates } from './backlogState';
import { useCompleteSprint, useDeleteSprint, useStartSprint, useUpdateSprint } from './api';

interface Common {
  org: string;
  project: string;
  online: boolean;
  onClose: () => void;
}

function Actions({
  pending,
  disabled,
  submitLabel,
  onClose,
  danger,
}: {
  pending: boolean;
  disabled: boolean;
  submitLabel: string;
  onClose: () => void;
  danger?: boolean;
}) {
  return (
    <div className="flex justify-end gap-2 pt-2">
      <Button type="button" variant="ghost" onClick={onClose}>
        Cancel
      </Button>
      <Button
        type="submit"
        variant={danger ? 'danger' : 'primary'}
        disabled={pending || disabled}
        aria-busy={pending}
      >
        {submitLabel}
      </Button>
    </div>
  );
}

function OfflineNote({ online }: { online: boolean }) {
  if (online) return null;
  return (
    <p role="status" className="rounded-md bg-warning-soft px-3 py-2 text-sm text-warning">
      You are offline. Reconnect to save changes.
    </p>
  );
}

export function StartSprintDialog({
  sprint,
  org,
  project,
  online,
  onClose,
}: Common & { sprint: Sprint }) {
  const start = useStartSprint(org, project);
  const toast = useToast();
  const defaults = defaultSprintDates();
  const [from, setFrom] = useState(defaults.start);
  const [to, setTo] = useState(defaults.end);
  const [error, setError] = useState<string | null>(null);

  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    if (!online || start.isPending) return;
    const startAt = new Date(from);
    const endAt = new Date(to);
    if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime()) || endAt <= startAt) {
      setError('The end must be after the start.');
      return;
    }
    setError(null);
    start.mutate(
      { id: sprint.id, start_at: startAt.toISOString(), end_at: endAt.toISOString() },
      {
        onSuccess: () => {
          showSuccessToast(toast, {
            feedbackInvocationId: createFeedbackInvocationId(),
            title: `${sprint.name} started`,
            description: 'Its issues now appear on the board.',
          });
          onClose();
        },
      },
    );
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        title={`Start ${sprint.name}`}
        description={`${String(sprint.issue_count)} issues will be on the board.`}
      >
        <form onSubmit={submit} noValidate className="space-y-3">
          <FormError>
            {start.error ? mutationErrorMessage(start.error, 'generic-project') : null}
          </FormError>
          <Field label="Start" error={error}>
            {(props) => (
              <Input
                type="datetime-local"
                required
                value={from}
                onChange={(e) => {
                  setFrom(e.target.value);
                }}
                {...props}
              />
            )}
          </Field>
          <Field label="End">
            {(props) => (
              <Input
                type="datetime-local"
                required
                value={to}
                onChange={(e) => {
                  setTo(e.target.value);
                }}
                {...props}
              />
            )}
          </Field>
          <OfflineNote online={online} />
          <Actions
            pending={start.isPending}
            disabled={!online}
            submitLabel="Start sprint"
            onClose={onClose}
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function CompleteSprintDialog({
  sprint,
  futures,
  openIssues,
  org,
  project,
  online,
  onClose,
}: Common & { sprint: Sprint; futures: Sprint[]; openIssues: number }) {
  const complete = useCompleteSprint(org, project);
  const toast = useToast();
  const [target, setTarget] = useState('backlog');

  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    if (!online || complete.isPending) return;
    complete.mutate(
      { id: sprint.id, target },
      {
        onSuccess: (result) => {
          showSuccessToast(toast, {
            feedbackInvocationId: createFeedbackInvocationId(),
            title: `${sprint.name} completed`,
            description:
              result.moved_issues === 0
                ? 'No open issues to move.'
                : `${String(result.moved_issues)} open issues moved ${target === 'backlog' ? 'to the backlog' : 'to the next sprint'}.`,
          });
          onClose();
        },
      },
    );
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        title={`Complete ${sprint.name}`}
        description={
          openIssues === 0
            ? 'All issues are done.'
            : `${String(openIssues)} open issues will be moved. Done issues stay in the sprint.`
        }
      >
        <form onSubmit={submit} className="space-y-3">
          <FormError>
            {complete.error ? mutationErrorMessage(complete.error, 'generic-project') : null}
          </FormError>
          <label className="block text-sm font-medium">
            Move open issues to
            <select
              className="mt-1 block h-8 w-full rounded-md border border-line-strong bg-surface px-2"
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
          <OfflineNote online={online} />
          <Actions
            pending={complete.isPending}
            disabled={!online}
            submitLabel="Complete sprint"
            onClose={onClose}
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function EditSprintDialog({
  sprint,
  org,
  project,
  online,
  onClose,
}: Common & { sprint: Sprint }) {
  const update = useUpdateSprint(org, project);
  const [name, setName] = useState(sprint.name);
  const [goal, setGoal] = useState(sprint.goal ?? '');
  const [error, setError] = useState<string | null>(null);

  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    if (!online || update.isPending) return;
    if (!name.trim()) {
      setError('Enter a sprint name.');
      return;
    }
    setError(null);
    update.mutate(
      { id: sprint.id, name: name.trim(), goal: goal.trim() || null },
      { onSuccess: onClose },
    );
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent title="Edit sprint">
        <form onSubmit={submit} noValidate className="space-y-3">
          <FormError>
            {update.error ? mutationErrorMessage(update.error, 'generic-project') : null}
          </FormError>
          <Field label="Sprint name" error={error}>
            {(props) => (
              <Input
                maxLength={100}
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                }}
                {...props}
              />
            )}
          </Field>
          <Field label="Sprint goal (optional)">
            {(props) => (
              <Textarea
                maxLength={1000}
                rows={3}
                value={goal}
                onChange={(e) => {
                  setGoal(e.target.value);
                }}
                {...props}
              />
            )}
          </Field>
          <OfflineNote online={online} />
          <Actions
            pending={update.isPending}
            disabled={!online}
            submitLabel="Save"
            onClose={onClose}
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteSprintDialog({
  sprint,
  org,
  project,
  online,
  onClose,
}: Common & { sprint: Sprint }) {
  const remove = useDeleteSprint(org, project);
  const toast = useToast();

  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    if (!online || remove.isPending) return;
    remove.mutate(sprint.id, {
      onSuccess: () => {
        showSuccessToast(toast, {
          feedbackInvocationId: createFeedbackInvocationId(),
          title: `${sprint.name} deleted`,
          description: 'Its issues are back in the backlog.',
        });
        onClose();
      },
    });
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        title={`Delete ${sprint.name}?`}
        description="Only planned sprints can be deleted. Its issues return to the backlog; nothing else is lost."
      >
        <form onSubmit={submit} className="space-y-3">
          <FormError>
            {remove.error ? mutationErrorMessage(remove.error, 'generic-project') : null}
          </FormError>
          <OfflineNote online={online} />
          <Actions
            pending={remove.isPending}
            disabled={!online}
            submitLabel="Delete sprint"
            onClose={onClose}
            danger
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}
