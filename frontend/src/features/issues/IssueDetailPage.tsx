import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

import { NotFoundPage } from '../../app/pages/NotFoundPage';
import { FormError } from '../../components/ui/Form';
import { ErrorState, LoadingState } from '../../components/ui/States';
import { ApiError } from '../../lib/api/errors';
import type { Issue } from '../../lib/api/types';
import { describeError } from '../../lib/forms';
import { useSession } from '../auth/api';
import { CommentsSection } from '../comments/CommentsSection';
import { useProject, useProjectMembers } from '../projects/api';

import {
  useApplyTransition,
  useChildren,
  useDeleteIssue,
  useIssue,
  useIssueTypes,
  useLabels,
  usePriorities,
  useTransitions,
  useUpdateIssue,
  type IssueChanges,
} from './api';

type Field = 'summary' | 'description' | 'type_id' | 'priority_id' | 'assignee_id';

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
      canAssign={writable && permissions.includes('issue.assign')}
      canTransition={writable && permissions.includes('issue.transition')}
      canComment={writable && permissions.includes('comment.create')}
      canDeleteAnyComment={writable && permissions.includes('comment.delete_any')}
      onReload={() => void issue.refetch()}
    />
  );
}

function IssueView({
  org,
  issue,
  canEdit,
  canDelete,
  canAssign,
  canTransition,
  canComment,
  canDeleteAnyComment,
  onReload,
}: {
  org: string;
  issue: Issue;
  canEdit: boolean;
  canDelete: boolean;
  canAssign: boolean;
  canTransition: boolean;
  canComment: boolean;
  canDeleteAnyComment: boolean;
  onReload: () => void;
}) {
  const navigate = useNavigate();
  const session = useSession();
  const types = useIssueTypes(org);
  const priorities = usePriorities(org);
  const members = useProjectMembers(org, issue.project_key);
  const labels = useLabels(org, issue.project_key);
  const transitions = useTransitions(org, issue.key);
  const children = useChildren(org, issue.key);
  const update = useUpdateIssue(org, issue.key);
  const transition = useApplyTransition(org, issue.key);
  const remove = useDeleteIssue(org, issue.key);
  const [editing, setEditing] = useState<Field | null>(null);
  const [draft, setDraft] = useState('');
  const [labelDraft, setLabelDraft] = useState<string[] | null>(null);
  const [transitionId, setTransitionId] = useState('');
  const conflict =
    (update.error instanceof ApiError && update.error.status === 412) ||
    (transition.error instanceof ApiError && transition.error.status === 412);

  const start = (field: Field, value: string) => {
    update.reset();
    setEditing(field);
    setDraft(value);
  };
  const save = (field: Field) => {
    const changes: IssueChanges =
      field === 'description'
        ? { description: draft || null }
        : field === 'assignee_id'
          ? { assignee_id: draft || null }
          : { [field]: draft };
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
  const editButton = (field: Field, label: string, value: string, allowed: boolean) =>
    allowed && editing === null ? (
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

  const currentLabels = issue.labels;
  const activeLabelIds = labelDraft ?? currentLabels.map((l) => l.id);
  const saveLabels = () => {
    if (labelDraft === null) return;
    update.mutate(
      { changes: { label_ids: labelDraft }, version: issue.version },
      {
        onSuccess: () => {
          setLabelDraft(null);
        },
      },
    );
  };

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
              transition.reset();
              onReload();
            }}
          >
            Reload latest version
          </button>
        </div>
      ) : (
        <>
          <FormError>{update.error ? describeError(update.error) : null}</FormError>
          <FormError>{transition.error ? describeError(transition.error) : null}</FormError>
        </>
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
          {editButton('summary', 'summary', issue.summary, canEdit)}
        </div>
      )}
      {issue.parent ? (
        <p className="text-sm text-slate-600">
          Part of{' '}
          <Link className="text-blue-700 underline" to={`/o/${org}/issues/${issue.parent.key}`}>
            {issue.parent.key} {issue.parent.summary}
          </Link>
        </p>
      ) : null}
      <dl className="grid grid-cols-[8rem_1fr] gap-2 text-sm">
        <dt className="font-medium">Status</dt>
        <dd className="flex items-center gap-2">
          <span>{issue.status.name}</span>
          {canTransition && (transitions.data ?? []).length > 0 ? (
            <>
              <select
                aria-label="Status"
                className="rounded border border-slate-300 px-2 py-1"
                value={transitionId}
                onChange={(e) => {
                  setTransitionId(e.target.value);
                }}
              >
                <option value="">Move to…</option>
                {(transitions.data ?? []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.to_status.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="rounded bg-blue-700 px-2 py-1 text-xs text-white disabled:opacity-60"
                disabled={!transitionId || transition.isPending}
                onClick={() => {
                  transition.mutate(
                    { transitionId, version: issue.version },
                    {
                      onSuccess: () => {
                        setTransitionId('');
                      },
                    },
                  );
                }}
              >
                Move
              </button>
            </>
          ) : null}
        </dd>
        <dt className="font-medium">Type</dt>
        <dd>
          {editing === 'type_id' ? (
            editor('type_id', choice(types.data ?? [], 'Type'))
          ) : (
            <>
              {issue.type.name} {editButton('type_id', 'type', issue.type.id, canEdit)}
            </>
          )}
        </dd>
        <dt className="font-medium">Priority</dt>
        <dd>
          {editing === 'priority_id' ? (
            editor('priority_id', choice(priorities.data ?? [], 'Priority'))
          ) : (
            <>
              {issue.priority.name}{' '}
              {editButton('priority_id', 'priority', issue.priority.id, canEdit)}
            </>
          )}
        </dd>
        <dt className="font-medium">Reporter</dt>
        <dd>{issue.reporter.display_name}</dd>
        <dt className="font-medium">Assignee</dt>
        <dd>
          {editing === 'assignee_id' ? (
            editor(
              'assignee_id',
              <select
                aria-label="Assignee"
                className="rounded border border-slate-300 px-2 py-1"
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                }}
              >
                <option value="">Unassigned</option>
                {(members.data ?? []).map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.display_name}
                  </option>
                ))}
              </select>,
            )
          ) : (
            <>
              {issue.assignee?.display_name ?? 'Unassigned'}{' '}
              {editButton('assignee_id', 'assignee', issue.assignee?.id ?? '', canAssign)}
            </>
          )}
        </dd>
      </dl>
      <section aria-labelledby="labels-title" className="space-y-2">
        <h2 id="labels-title" className="text-sm font-medium">
          Labels
        </h2>
        {labelDraft === null ? (
          <div className="flex flex-wrap items-center gap-2">
            {currentLabels.length === 0 ? (
              <span className="text-sm text-slate-500">No labels.</span>
            ) : (
              currentLabels.map((l) => (
                <span
                  key={l.id}
                  className="rounded-full px-2 py-0.5 text-xs text-white"
                  style={{ backgroundColor: l.color }}
                >
                  {l.name}
                </span>
              ))
            )}
            {canEdit && editing === null ? (
              <button
                type="button"
                className="text-sm text-blue-700 underline"
                onClick={() => {
                  setLabelDraft(currentLabels.map((l) => l.id));
                }}
              >
                Edit labels
              </button>
            ) : null}
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-3">
              {(labels.data ?? []).map((l) => (
                <label key={l.id} className="flex items-center gap-1 text-sm">
                  <input
                    type="checkbox"
                    checked={activeLabelIds.includes(l.id)}
                    onChange={(e) => {
                      setLabelDraft((ids) => {
                        const base = ids ?? [];
                        return e.target.checked
                          ? [...base, l.id]
                          : base.filter((id) => id !== l.id);
                      });
                    }}
                  />
                  {l.name}
                </label>
              ))}
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                className="rounded bg-blue-700 px-3 py-1 text-white"
                disabled={update.isPending}
                onClick={saveLabels}
              >
                Save
              </button>
              <button
                type="button"
                className="underline"
                onClick={() => {
                  setLabelDraft(null);
                  update.reset();
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>
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
            {editButton('description', 'description', issue.description ?? '', canEdit)}
          </>
        )}
      </section>
      {(children.data ?? []).length > 0 ? (
        <section aria-labelledby="children-title" className="space-y-2">
          <h2 id="children-title" className="text-lg font-semibold">
            Children
          </h2>
          <ul className="space-y-1 text-sm">
            {(children.data ?? []).map((child) => (
              <li key={child.id}>
                <Link className="text-blue-700 underline" to={`/o/${org}/issues/${child.key}`}>
                  {child.key}
                </Link>{' '}
                {child.summary} · {child.status.name}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
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
      <CommentsSection
        org={org}
        issueKey={issue.key}
        currentUserId={session.data?.user.id ?? ''}
        canComment={canComment}
        canDeleteAny={canDeleteAnyComment}
      />
    </article>
  );
}
