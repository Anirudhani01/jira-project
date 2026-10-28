import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

import { NotFoundPage } from '../../app/pages/NotFoundPage';
import { FormError } from '../../components/ui/Form';
import { ErrorState, LoadingState } from '../../components/ui/States';
import { ApiError } from '../../lib/api/errors';
import type { Issue } from '../../lib/api/types';
import { describeError } from '../../lib/forms';
import { useProject } from '../projects/api';

import {
  useDeleteIssue,
  useIssue,
  useIssueActivity,
  useIssueTypes,
  usePriorities,
  useUpdateIssue,
  type IssueChanges,
} from './api';

type Field = 'summary' | 'description' | 'type_id' | 'priority_id';

/** Issue detail: inline edits are sent with If-Match. On 412 the user's draft is kept and a
 * conflict banner offers to reload the latest version. */
export function IssueDetailPage() {
  const { org = '', issueKey = '' } = useParams();
  const issue = useIssue(org, issueKey);
  const projectKey = issue.data?.project_key ?? issueKey.split('-')[0] ?? '';
  const project = useProject(org, projectKey);

  if (issue.isPending) return <LoadingState label="Loading issue" />;
  if (issue.error instanceof ApiError && issue.error.status === 404) return <NotFoundPage />;
  if (issue.isError) return <ErrorState error={issue.error} />;
  const permissions = project.data?.permissions ?? [];
  const writable = !project.data?.archived;
  return (
    <IssueView
      org={org}
      issue={issue.data}
      canEdit={writable && permissions.includes('issue.edit')}
      canDelete={writable && permissions.includes('issue.delete')}
      onReload={() => void issue.refetch()}
    />
  );
}

function IssueView({
  org,
  issue,
  canEdit,
  canDelete,
  onReload,
}: {
  org: string;
  issue: Issue;
  canEdit: boolean;
  canDelete: boolean;
  onReload: () => void;
}) {
  const navigate = useNavigate();
  const types = useIssueTypes(org);
  const priorities = usePriorities(org);
  const activity = useIssueActivity(org, issue.key);
  const update = useUpdateIssue(org, issue.key);
  const remove = useDeleteIssue(org, issue.key);
  const [editing, setEditing] = useState<Field | null>(null);
  const [draft, setDraft] = useState('');
  const conflict = update.error instanceof ApiError && update.error.status === 412;

  const start = (field: Field, value: string) => {
    update.reset();
    setEditing(field);
    setDraft(value);
  };
  const save = (field: Field) => {
    const changes: IssueChanges =
      field === 'description' ? { description: draft || null } : { [field]: draft };
    update.mutate(
      { changes, version: issue.version },
      {
        onSuccess: () => {
          setEditing(null);
        },
      },
    );
  };
  const editor = (field: Field, input: React.ReactNode) => (
    <div className="space-y-2">
      {input}
      <div className="flex gap-3">
        <button
          type="button"
          className="rounded bg-blue-700 px-3 py-1 text-white"
          disabled={update.isPending}
          onClick={() => {
            save(field);
          }}
        >
          Save
        </button>
        <button
          type="button"
          className="underline"
          onClick={() => {
            setEditing(null);
            update.reset();
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
  const editButton = (field: Field, label: string, value: string) =>
    canEdit && editing === null ? (
      <button
        type="button"
        className="text-sm text-blue-700 underline"
        onClick={() => {
          start(field, value);
        }}
      >
        Edit {label}
      </button>
    ) : null;
  const choice = (options: { id: string; name: string }[], label: string) => (
    <select
      aria-label={label}
      className="rounded border border-slate-300 px-2 py-1"
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value);
      }}
    >
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
    </select>
  );

  return (
    <article aria-labelledby="issue-title" className="space-y-6">
      <p className="text-sm">
        <Link className="text-blue-700 underline" to={`/o/${org}/p/${issue.project_key}/issues`}>
          {issue.project_key} issues
        </Link>{' '}
        / <span className="font-mono">{issue.key}</span>
      </p>
      {conflict ? (
        <div role="alert" className="rounded border border-amber-300 bg-amber-50 p-3 text-sm">
          Someone else changed this issue. Your edit was not saved; your draft is kept below.{' '}
          <button
            type="button"
            className="font-medium underline"
            onClick={() => {
              update.reset();
              onReload();
            }}
          >
            Reload latest version
          </button>
        </div>
      ) : (
        <FormError>{update.error ? describeError(update.error) : null}</FormError>
      )}
      <FormError>{remove.error ? describeError(remove.error) : null}</FormError>
      {editing === 'summary' ? (
        editor(
          'summary',
          <input
            aria-label="Summary"
            className="w-full rounded border border-slate-300 px-2 py-1 text-xl"
            maxLength={255}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
            }}
          />,
        )
      ) : (
        <div className="flex items-center gap-3">
          <h1 id="issue-title" className="text-2xl font-semibold">
            {issue.summary}
          </h1>
          {editButton('summary', 'summary', issue.summary)}
        </div>
      )}
      <dl className="grid grid-cols-[8rem_1fr] gap-2 text-sm">
        <dt className="font-medium">Status</dt>
        <dd>{issue.status.name}</dd>
        <dt className="font-medium">Type</dt>
        <dd>
          {editing === 'type_id' ? (
            editor(
              'type_id',
              choice(
                (types.data ?? []).filter((t) => t.kind !== 'subtask'),
                'Type',
              ),
            )
          ) : (
            <>
              {issue.type.name} {editButton('type_id', 'type', issue.type.id)}
            </>
          )}
        </dd>
        <dt className="font-medium">Priority</dt>
        <dd>
          {editing === 'priority_id' ? (
            editor('priority_id', choice(priorities.data ?? [], 'Priority'))
          ) : (
            <>
              {issue.priority.name} {editButton('priority_id', 'priority', issue.priority.id)}
            </>
          )}
        </dd>
        <dt className="font-medium">Reporter</dt>
        <dd>{issue.reporter.display_name}</dd>
        <dt className="font-medium">Assignee</dt>
        <dd>{issue.assignee?.display_name ?? 'Unassigned'}</dd>
      </dl>
      <section aria-labelledby="description-title" className="space-y-2">
        <h2 id="description-title" className="text-lg font-semibold">
          Description
        </h2>
        {editing === 'description' ? (
          editor(
            'description',
            <textarea
              aria-label="Description"
              className="w-full rounded border border-slate-300 px-2 py-1"
              rows={6}
              maxLength={32000}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
              }}
            />,
          )
        ) : (
          <>
            <p className="whitespace-pre-wrap">{issue.description ?? 'No description.'}</p>
            {editButton('description', 'description', issue.description ?? '')}
          </>
        )}
      </section>
      {canDelete ? (
        <button
          type="button"
          className="text-red-700 underline"
          onClick={() => {
            if (window.confirm(`Delete ${issue.key}?`)) {
              remove.mutate(undefined, {
                onSuccess: () => void navigate(`/o/${org}/p/${issue.project_key}/issues`),
              });
            }
          }}
        >
          Delete issue
        </button>
      ) : null}
      <section aria-labelledby="activity-title" className="space-y-2">
        <h2 id="activity-title" className="text-lg font-semibold">
          Activity
        </h2>
        <ol className="space-y-1 text-sm">
          {(activity.data ?? []).map((a) => (
            <li key={a.id}>
              {a.actor?.display_name ?? 'System'}{' '}
              {a.action === 'updated' ? `changed ${a.field ?? ''}` : a.action} ·{' '}
              <time dateTime={a.created_at}>{new Date(a.created_at).toLocaleString()}</time>
            </li>
          ))}
        </ol>
      </section>
    </article>
  );
}
