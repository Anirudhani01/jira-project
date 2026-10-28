import { useState, type SyntheticEvent } from 'react';
import { useNavigate } from 'react-router';

import { FormError, SubmitButton, TextField } from '../../components/ui/Form';
import { ApiError } from '../../lib/api/errors';
import { describeError } from '../../lib/forms';

import { useCreateIssue, useIssueTypes, usePriorities } from './api';

/** Modal create form. One Idempotency-Key per dialog: resubmitting after a lost response
 * replays the original issue instead of creating a second one. */
export function CreateIssueDialog({
  org,
  project,
  onClose,
}: {
  org: string;
  project: string;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const types = useIssueTypes(org);
  const priorities = usePriorities(org);
  const create = useCreateIssue(org, project);
  const [summary, setSummary] = useState('');
  const [description, setDescription] = useState('');
  const [typeId, setTypeId] = useState('');
  const [priorityId, setPriorityId] = useState('');
  // Sub-tasks need a parent (M7), so they are not offered here.
  const creatable = (types.data ?? []).filter((t) => t.kind !== 'subtask');
  const effectiveType = typeId || (creatable.find((t) => t.name === 'Task') ?? creatable[0])?.id;
  const effectivePriority =
    priorityId || (priorities.data?.find((p) => p.name === 'Medium') ?? priorities.data?.[0])?.id;

  const fieldError = (field: string) =>
    create.error instanceof ApiError
      ? create.error.fieldErrors.find((e) => e.field === `body.${field}`)?.message
      : undefined;

  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    if (!effectiveType || !effectivePriority) return;
    create.mutate(
      {
        idempotencyKey,
        body: {
          type_id: effectiveType,
          priority_id: effectivePriority,
          summary,
          ...(description ? { description } : {}),
        },
      },
      { onSuccess: (issue) => void navigate(`/o/${org}/issues/${issue.key}`) },
    );
  };

  return (
    <div className="fixed inset-0 flex items-start justify-center bg-slate-900/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-issue-title"
        className="w-full max-w-lg rounded bg-white p-6 shadow"
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
        }}
      >
        <form onSubmit={submit} className="space-y-4">
          <h2 id="create-issue-title" className="text-lg font-semibold">
            Create issue in {project}
          </h2>
          <FormError>{create.error ? describeError(create.error) : null}</FormError>
          <label className="block text-sm font-medium">
            Type
            <select
              className="mt-1 block w-full rounded border border-slate-300 px-2 py-2"
              value={effectiveType ?? ''}
              onChange={(e) => {
                setTypeId(e.target.value);
              }}
            >
              {creatable.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <TextField
            label="Summary"
            required
            maxLength={255}
            value={summary}
            error={fieldError('summary')}
            onChange={(e) => {
              setSummary(e.target.value);
            }}
          />
          <label className="block text-sm font-medium">
            Description
            <textarea
              className="mt-1 block w-full rounded border border-slate-300 px-2 py-2"
              maxLength={32000}
              rows={4}
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
              }}
            />
          </label>
          <label className="block text-sm font-medium">
            Priority
            <select
              className="mt-1 block w-full rounded border border-slate-300 px-2 py-2"
              value={effectivePriority ?? ''}
              onChange={(e) => {
                setPriorityId(e.target.value);
              }}
            >
              {(priorities.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <div className="flex gap-3">
            <SubmitButton pending={create.isPending}>Create</SubmitButton>
            <button type="button" className="underline" onClick={onClose}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
