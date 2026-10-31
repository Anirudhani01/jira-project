import { useState, type SyntheticEvent } from 'react';

import { Button } from '../../components/ui/Button';
import { FormError } from '../../components/ui/Form';
import { Field, Input, Textarea } from '../../components/ui/Input';
import { Dialog, DialogContent } from '../../components/ui/Overlay';
import { useToast } from '../../components/ui/Toast';
import { ApiError } from '../../lib/api/errors';
import type { Version } from '../../lib/api/types';
import { createFeedbackInvocationId, showSuccessToast } from '../../lib/ux/mutationFeedback';
import { mutationErrorMessage } from '../../lib/ux/permissionDenied';

import { useCreateVersion, useDeleteVersion, useReleaseVersion, useUpdateVersion } from './planApi';

interface Common {
  org: string;
  project: string;
  online: boolean;
  onClose: () => void;
}

export const todayInput = (now: Date = new Date()): string => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${String(now.getFullYear())}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

function Footer({
  pending,
  online,
  label,
  onClose,
  danger,
}: {
  pending: boolean;
  online: boolean;
  label: string;
  onClose: () => void;
  danger?: boolean;
}) {
  return (
    <>
      {!online ? (
        <p role="status" className="rounded-md bg-warning-soft px-3 py-2 text-sm text-warning">
          You are offline. Reconnect to save changes.
        </p>
      ) : null}
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="submit"
          variant={danger ? 'danger' : 'primary'}
          disabled={pending || !online}
          aria-busy={pending}
        >
          {label}
        </Button>
      </div>
    </>
  );
}

/** Create (no `version`) or edit a version: name, description, start and release dates. */
export function VersionFormDialog({
  org,
  project,
  online,
  onClose,
  version,
}: Common & { version?: Version }) {
  const create = useCreateVersion(org, project);
  const update = useUpdateVersion(org, project);
  const mutation = version ? update : create;
  const [name, setName] = useState(version?.name ?? '');
  const [description, setDescription] = useState(version?.description ?? '');
  const [start, setStart] = useState(version?.start_date ?? '');
  const [end, setEnd] = useState(version?.release_date ?? '');
  const [errors, setErrors] = useState<{ name?: string; end?: string }>({});

  const serverName =
    mutation.error instanceof ApiError && mutation.error.code === 'version_name_taken'
      ? 'A version with this name already exists.'
      : undefined;
  const failure =
    mutation.error && !serverName ? mutationErrorMessage(mutation.error, 'generic-project') : null;

  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    if (!online || mutation.isPending) return;
    const next: { name?: string; end?: string } = {};
    if (!name.trim()) next.name = 'Enter a version name.';
    if (start && end && end < start)
      next.end = 'The release date must not be before the start date.';
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    const body = {
      name: name.trim(),
      description: description.trim() || null,
      start_date: start || null,
      release_date: end || null,
    };
    if (version) {
      update.mutate({ id: version.id, ...body }, { onSuccess: onClose });
    } else {
      create.mutate(
        {
          name: body.name,
          ...(body.description ? { description: body.description } : {}),
          ...(body.start_date ? { start_date: body.start_date } : {}),
          ...(body.release_date ? { release_date: body.release_date } : {}),
        },
        { onSuccess: onClose },
      );
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent title={version ? 'Edit version' : 'Create version'}>
        <form onSubmit={submit} noValidate className="space-y-3">
          <FormError>{failure}</FormError>
          <Field label="Name" error={errors.name ?? serverName ?? null}>
            {(props) => (
              <Input
                autoFocus
                maxLength={100}
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                }}
                {...props}
              />
            )}
          </Field>
          <Field label="Description (optional)">
            {(props) => (
              <Textarea
                maxLength={1000}
                rows={3}
                value={description}
                onChange={(e) => {
                  setDescription(e.target.value);
                }}
                {...props}
              />
            )}
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Start date (optional)">
              {(props) => (
                <Input
                  type="date"
                  value={start}
                  onChange={(e) => {
                    setStart(e.target.value);
                  }}
                  {...props}
                />
              )}
            </Field>
            <Field label="Release date (optional)" error={errors.end ?? null}>
              {(props) => (
                <Input
                  type="date"
                  value={end}
                  onChange={(e) => {
                    setEnd(e.target.value);
                  }}
                  {...props}
                />
              )}
            </Field>
          </div>
          <Footer
            pending={mutation.isPending}
            online={online}
            label={version ? 'Save' : 'Create version'}
            onClose={onClose}
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Release: pick the release date and what happens to unresolved (not done) issues. */
export function ReleaseVersionDialog({
  org,
  project,
  online,
  onClose,
  version,
  others,
}: Common & { version: Version; others: Version[] }) {
  const release = useReleaseVersion(org, project);
  const toast = useToast();
  const unresolved = version.issue_count - version.done_count;
  const targets = others.filter((v) => v.id !== version.id && v.status === 'unreleased');
  const [date, setDate] = useState(todayInput());
  const [mode, setMode] = useState<'ignore' | 'move'>('ignore');
  const [target, setTarget] = useState(targets[0]?.id ?? '');
  const [error, setError] = useState<string | null>(null);

  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    if (!online || release.isPending) return;
    if (version.start_date && date < version.start_date) {
      setError('The release date must not be before the start date.');
      return;
    }
    if (mode === 'move' && !target) {
      setError('Choose a version to move the unresolved issues to.');
      return;
    }
    setError(null);
    release.mutate(
      {
        id: version.id,
        release_date: date,
        unresolved: mode,
        ...(mode === 'move' ? { move_to: target } : {}),
      },
      {
        onSuccess: (result) => {
          showSuccessToast(toast, {
            feedbackInvocationId: createFeedbackInvocationId(),
            title: `${version.name} released`,
            ...(result.moved_issues > 0
              ? { description: `${String(result.moved_issues)} unresolved issues moved.` }
              : {}),
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
        title={`Release ${version.name}`}
        description={`${String(version.done_count)} of ${String(version.issue_count)} issues are done.`}
      >
        <form onSubmit={submit} noValidate className="space-y-3">
          <FormError>
            {release.error ? mutationErrorMessage(release.error, 'generic-project') : null}
          </FormError>
          <Field label="Release date" error={error}>
            {(props) => (
              <Input
                type="date"
                required
                value={date}
                onChange={(e) => {
                  setDate(e.target.value);
                }}
                {...props}
              />
            )}
          </Field>
          {unresolved > 0 ? (
            <fieldset className="space-y-1 text-sm">
              <legend className="font-medium">
                {unresolved} unresolved {unresolved === 1 ? 'issue' : 'issues'}
              </legend>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="unresolved"
                  checked={mode === 'ignore'}
                  onChange={() => {
                    setMode('ignore');
                  }}
                />
                Leave them in this version
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="unresolved"
                  checked={mode === 'move'}
                  disabled={targets.length === 0}
                  onChange={() => {
                    setMode('move');
                  }}
                />
                Move them to another version
              </label>
              {mode === 'move' ? (
                <select
                  aria-label="Move unresolved issues to"
                  className="ml-6 h-8 rounded-md border border-line-strong bg-surface px-2"
                  value={target}
                  onChange={(e) => {
                    setTarget(e.target.value);
                  }}
                >
                  {targets.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
              ) : null}
              {targets.length === 0 ? (
                <p className="ml-6 text-xs text-fg-muted">
                  Create another unreleased version to move issues to it.
                </p>
              ) : null}
            </fieldset>
          ) : null}
          <Footer
            pending={release.isPending}
            online={online}
            label="Release version"
            onClose={onClose}
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Delete: issues lose their fix version, or move to another version (a merge). */
export function DeleteVersionDialog({
  org,
  project,
  online,
  onClose,
  version,
  others,
}: Common & { version: Version; others: Version[] }) {
  const remove = useDeleteVersion(org, project);
  const toast = useToast();
  const targets = others.filter((v) => v.id !== version.id && v.status !== 'archived');
  const [mode, setMode] = useState<'clear' | 'move'>('clear');
  const [target, setTarget] = useState(targets[0]?.id ?? '');

  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    if (!online || remove.isPending) return;
    remove.mutate(
      { id: version.id, ...(mode === 'move' && target ? { moveTo: target } : {}) },
      {
        onSuccess: () => {
          showSuccessToast(toast, {
            feedbackInvocationId: createFeedbackInvocationId(),
            title: `${version.name} deleted`,
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
        title={`Delete ${version.name}?`}
        description={
          version.issue_count > 0
            ? `${String(version.issue_count)} issues use this version.`
            : 'No issues use this version.'
        }
      >
        <form onSubmit={submit} className="space-y-3">
          <FormError>
            {remove.error ? mutationErrorMessage(remove.error, 'generic-project') : null}
          </FormError>
          {version.issue_count > 0 ? (
            <fieldset className="space-y-1 text-sm">
              <legend className="font-medium">What should happen to its issues?</legend>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="delete-mode"
                  checked={mode === 'clear'}
                  onChange={() => {
                    setMode('clear');
                  }}
                />
                Remove this version from them
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="delete-mode"
                  checked={mode === 'move'}
                  disabled={targets.length === 0}
                  onChange={() => {
                    setMode('move');
                  }}
                />
                Move them to another version
              </label>
              {mode === 'move' ? (
                <select
                  aria-label="Move issues to"
                  className="ml-6 h-8 rounded-md border border-line-strong bg-surface px-2"
                  value={target}
                  onChange={(e) => {
                    setTarget(e.target.value);
                  }}
                >
                  {targets.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
              ) : null}
            </fieldset>
          ) : null}
          <Footer
            pending={remove.isPending}
            online={online}
            label="Delete version"
            onClose={onClose}
            danger
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}
