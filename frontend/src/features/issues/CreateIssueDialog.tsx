import { useState, type SyntheticEvent } from 'react';
import { useNavigate } from 'react-router';

import { FormError, SubmitButton, TextField } from '../../components/ui/Form';
import { ApiError } from '../../lib/api/errors';
import { describeError } from '../../lib/forms';
import { useProjectMembers } from '../projects/api';

import { useCreateIssue, useIssue, useIssueTypes, useLabels, usePriorities } from './api';

/** Resolves a typed-in parent key ("WEB-3") to its id, enabled only once something has
 * been typed. Used by both the parent and (implicitly) the hierarchy-level check:
 * the server still validates the kind, so this is a lookup, not a guarantee. */
function useParentLookup(org: string, key: string) {
  const trimmed = key.trim();
  const result = useIssue(org, trimmed);
  return trimmed ? result : undefined;
}

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
  const members = useProjectMembers(org, project);
  const labels = useLabels(org, project);
  const create = useCreateIssue(org, project);
  const [summary, setSummary] = useState('');
  const [description, setDescription] = useState('');
  const [typeId, setTypeId] = useState('');
  const [priorityId, setPriorityId] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [parentKey, setParentKey] = useState('');
  const [labelIds, setLabelIds] = useState<string[]>([]);

  const effectiveType =
    typeId || (types.data?.find((t) => t.name === 'Task') ?? types.data?.[0])?.id;
  const effectivePriority =
    priorityId || (priorities.data?.find((p) => p.name === 'Medium') ?? priorities.data?.[0])?.id;
  const selectedType = types.data?.find((t) => t.id === effectiveType);
  const needsParent = selectedType?.kind === 'subtask';
  const parent = useParentLookup(org, parentKey);
  const parentResolved = !parentKey.trim() || (parent && !parent.isPending && !parent.isError);

  const fieldError = (field: string) =>
    create.error instanceof ApiError
      ? create.error.fieldErrors.find((e) => e.field === `body.${field}`)?.message
      : undefined;

  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    if (!effectiveType || !effectivePriority) return;
    if (needsParent && !parentKey.trim()) return;
    if (parentKey.trim() && !parent?.data) return;
    create.mutate(
      {
        idempotencyKey,
        body: {
          type_id: effectiveType,
          priority_id: effectivePriority,
          summary,
          ...(description ? { description } : {}),
          ...(assigneeId ? { assignee_id: assigneeId } : {}),
          ...(parent?.data ? { parent_id: parent.data.id } : {}),
          ...(labelIds.length ? { label_ids: labelIds } : {}),
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
              {(types.data ?? []).map((t) => (
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
          <label className="block text-sm font-medium">
            Assignee
            <select
              className="mt-1 block w-full rounded border border-slate-300 px-2 py-2"
              value={assigneeId}
              onChange={(e) => {
                setAssigneeId(e.target.value);
              }}
            >
              <option value="">Unassigned</option>
              {(members.data ?? []).map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.display_name}
                </option>
              ))}
            </select>
          </label>
          <TextField
            label={needsParent ? 'Parent (required for a sub-task)' : 'Parent (optional)'}
            placeholder="e.g. WEB-3"
            value={parentKey}
            error={
              parentKey.trim() && parent && !parent.isPending && parent.isError
                ? 'No issue with that key.'
                : fieldError('parent_id')
            }
            onChange={(e) => {
              setParentKey(e.target.value);
            }}
          />
          {(labels.data ?? []).length > 0 && (
            <fieldset className="space-y-1">
              <legend className="text-sm font-medium">Labels</legend>
              {(labels.data ?? []).map((l) => (
                <label key={l.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={labelIds.includes(l.id)}
                    onChange={(e) => {
                      setLabelIds((ids) =>
                        e.target.checked ? [...ids, l.id] : ids.filter((id) => id !== l.id),
                      );
                    }}
                  />
                  <span
                    className="inline-block h-3 w-3 rounded-full"
                    style={{ backgroundColor: l.color }}
                  />
                  {l.name}
                </label>
              ))}
            </fieldset>
          )}
          <div className="flex gap-3">
            <SubmitButton pending={create.isPending} disabled={!parentResolved}>
              Create
            </SubmitButton>
            <button type="button" className="underline" onClick={onClose}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
