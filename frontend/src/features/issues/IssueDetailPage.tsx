import { Pencil } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

import { NotFoundPage } from '../../app/pages/NotFoundPage';
import { Button, IconButton } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { FormError } from '../../components/ui/Form';
import { StatusLozenge } from '../../components/ui/IssueIcons';
import { Input, Textarea } from '../../components/ui/Input';
import { ErrorState, LoadingState } from '../../components/ui/States';
import { ApiError } from '../../lib/api/errors';
import type { Issue } from '../../lib/api/types';
import { describeError } from '../../lib/forms';
import { useSession } from '../auth/api';
import { CommentsSection } from '../comments/CommentsSection';
import { useProject, useProjectMembers } from '../projects/api';

import {
  useChildren,
  useDeleteIssue,
  useIssue,
  useIssueTypes,
  useLabels,
  usePriorities,
  useUpdateIssue,
  type IssueChanges,
} from './api';
import {
  IssueListAssigneeMenu,
  IssueListPriorityMenu,
  IssueListReporterMenu,
  IssueListStatusMenu,
  IssueListTypeMenu,
} from './IssueListRowMenus';

type Field = 'summary' | 'description';

const fieldLabelClass = 'pt-2.5 text-[13px] font-medium text-fg-muted sm:pt-0';
const fieldValueClass = 'min-h-9 flex items-center';

function InlineEditPanel({
  children,
  onSave,
  onCancel,
  saving,
  saveDisabled,
}: {
  children: ReactNode;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  saveDisabled?: boolean;
}) {
  return (
    <div className="rounded-lg border border-line bg-surface p-4 shadow-sm ring-1 ring-accent/10 sm:p-5">
      <div className="space-y-4">{children}</div>
      <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-line pt-4">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="button"
          variant="primary"
          size="sm"
          disabled={saving || saveDisabled}
          onClick={onSave}
        >
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>
  );
}

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
  const children = useChildren(org, issue.key);
  const update = useUpdateIssue(org, issue.key);
  const remove = useDeleteIssue(org, issue.key);
  const [editing, setEditing] = useState<Field | null>(null);
  const [draft, setDraft] = useState('');
  const [labelDraft, setLabelDraft] = useState<string[] | null>(null);
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
  const cancelEdit = () => {
    setEditing(null);
    update.reset();
  };
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
    <article aria-labelledby="issue-title" className="w-full space-y-6">
      <nav aria-label="Issue location" className="text-sm text-fg-muted">
        <Link
          className="font-medium text-accent hover:underline"
          to={`/o/${org}/p/${issue.project_key}/issues`}
        >
          {issue.project_key} issues
        </Link>
        <span aria-hidden="true"> / </span>
        <span className="font-mono text-fg">{issue.key}</span>
      </nav>

      {conflict ? (
        <div
          role="alert"
          className="rounded-lg border border-warning/40 bg-warning-soft px-4 py-3 text-sm text-fg"
        >
          Someone else changed this issue. Your edit was not saved; your draft is kept below.{' '}
          <Button
            type="button"
            variant="link"
            size="sm"
            className="h-auto px-0 py-0"
            onClick={() => {
              update.reset();
              onReload();
            }}
          >
            Reload latest version
          </Button>
        </div>
      ) : (
        <FormError>{update.error ? describeError(update.error) : null}</FormError>
      )}
      <FormError>{remove.error ? describeError(remove.error) : null}</FormError>

      <header className="space-y-2">
        <p className="font-mono text-xs font-medium uppercase tracking-wide text-fg-subtle">
          {issue.key}
        </p>
        {editing === 'summary' ? (
          <InlineEditPanel
            saving={update.isPending}
            saveDisabled={!draft.trim()}
            onSave={() => {
              save('summary');
            }}
            onCancel={cancelEdit}
          >
            <Input
              autoFocus
              aria-label="Summary"
              className="h-11 text-xl font-semibold sm:text-2xl"
              maxLength={255}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault();
                  cancelEdit();
                }
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  if (draft.trim() && !update.isPending) save('summary');
                }
              }}
            />
          </InlineEditPanel>
        ) : (
          <div className="flex flex-wrap items-start gap-2">
            <h1 id="issue-title" className="text-2xl font-semibold leading-snug text-fg">
              {issue.summary}
            </h1>
            {canEdit && editing === null ? (
              <IconButton
                type="button"
                size="sm"
                label="Edit summary"
                className="mt-1 shrink-0 text-fg-muted hover:text-fg"
                onClick={() => {
                  start('summary', issue.summary);
                }}
              >
                <Pencil className="size-4" aria-hidden="true" />
              </IconButton>
            ) : null}
          </div>
        )}
        {issue.parent ? (
          <p className="text-sm text-fg-muted">
            Part of{' '}
            <Link
              className="font-medium text-accent hover:underline"
              to={`/o/${org}/issues/${issue.parent.key}`}
            >
              {issue.parent.key} {issue.parent.summary}
            </Link>
          </p>
        ) : null}
      </header>

      <Card className="p-5 sm:p-6">
        <dl className="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-[minmax(7.5rem,9rem)_1fr]">
          <dt className={fieldLabelClass}>Status</dt>
          <dd className={fieldValueClass}>
            {canTransition ? (
              <IssueListStatusMenu org={org} issue={issue} canTransition={canTransition} />
            ) : (
              <StatusLozenge name={issue.status.name} category={issue.status.category} />
            )}
          </dd>

          <dt className={fieldLabelClass}>Type</dt>
          <dd className={fieldValueClass}>
            <IssueListTypeMenu org={org} issue={issue} types={types.data ?? []} canEdit={canEdit} />
          </dd>

          <dt className={fieldLabelClass}>Priority</dt>
          <dd className={fieldValueClass}>
            <IssueListPriorityMenu
              org={org}
              issue={issue}
              priorities={priorities.data ?? []}
              canEdit={canEdit}
            />
          </dd>

          <dt className={fieldLabelClass}>Reporter</dt>
          <dd className={fieldValueClass}>
            <IssueListReporterMenu
              org={org}
              issue={issue}
              members={members.data ?? []}
              canEdit={canEdit}
            />
          </dd>

          <dt className={fieldLabelClass}>Assignee</dt>
          <dd className={fieldValueClass}>
            <IssueListAssigneeMenu
              org={org}
              issue={issue}
              members={members.data ?? []}
              canAssign={canAssign}
            />
          </dd>
        </dl>
      </Card>

      <Card className="space-y-4 p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="labels-title" className="text-base font-semibold text-fg">
            Labels
          </h2>
          {canEdit && labelDraft === null && editing === null ? (
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto px-0 py-0"
              onClick={() => {
                setLabelDraft(currentLabels.map((l) => l.id));
              }}
            >
              Edit labels
            </Button>
          ) : null}
        </div>
        {labelDraft === null ? (
          <div className="flex flex-wrap items-center gap-2">
            {currentLabels.length === 0 ? (
              <span className="text-sm text-fg-muted">No labels.</span>
            ) : (
              currentLabels.map((l) => (
                <span
                  key={l.id}
                  className="rounded-full px-2.5 py-0.5 text-xs font-medium text-fg"
                  style={{ backgroundColor: `${l.color}33`, borderLeft: `3px solid ${l.color}` }}
                >
                  {l.name}
                </span>
              ))
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {(labels.data ?? []).map((l) => (
                <label key={l.id} className="flex items-center gap-2 text-sm text-fg">
                  <input
                    type="checkbox"
                    className="size-4 rounded border-line-strong accent-accent"
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
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="primary"
                size="sm"
                disabled={update.isPending}
                onClick={saveLabels}
              >
                Save
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setLabelDraft(null);
                  update.reset();
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </Card>

      <Card className="space-y-4 p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="description-title" className="text-base font-semibold text-fg">
            Description
          </h2>
          {canEdit && editing !== 'description' ? (
            <IconButton
              type="button"
              size="sm"
              label="Edit description"
              className="shrink-0 text-fg-muted hover:text-fg"
              onClick={() => {
                start('description', issue.description ?? '');
              }}
            >
              <Pencil className="size-4" aria-hidden="true" />
            </IconButton>
          ) : null}
        </div>
        {editing === 'description' ? (
          <InlineEditPanel
            saving={update.isPending}
            onSave={() => {
              save('description');
            }}
            onCancel={cancelEdit}
          >
            <Textarea
              autoFocus
              aria-label="Description"
              className="min-h-[10rem] text-sm leading-relaxed"
              rows={8}
              maxLength={32000}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault();
                  cancelEdit();
                }
              }}
            />
          </InlineEditPanel>
        ) : (
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-fg">
            {issue.description ?? <span className="text-fg-muted">No description.</span>}
          </p>
        )}
      </Card>

      {(children.data ?? []).length > 0 ? (
        <Card className="space-y-3 p-5 sm:p-6">
          <h2 id="children-title" className="text-base font-semibold text-fg">
            Children
          </h2>
          <ul className="space-y-2 text-sm">
            {(children.data ?? []).map((child) => (
              <li key={child.id} className="flex flex-wrap items-center gap-2">
                <Link
                  className="font-mono text-xs font-medium text-accent hover:underline"
                  to={`/o/${org}/issues/${child.key}`}
                >
                  {child.key}
                </Link>
                <span className="text-fg">{child.summary}</span>
                <StatusLozenge name={child.status.name} category={child.status.category} />
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {canDelete ? (
        <Button
          type="button"
          variant="link"
          className="text-danger hover:text-danger"
          onClick={() => {
            if (window.confirm(`Delete ${issue.key}?`)) {
              remove.mutate(undefined, {
                onSuccess: () => void navigate(`/o/${org}/p/${issue.project_key}/issues`),
              });
            }
          }}
        >
          Delete issue
        </Button>
      ) : null}

      <Card className="p-5 sm:p-6">
        <CommentsSection
          org={org}
          issueKey={issue.key}
          currentUserId={session.data?.user.id ?? ''}
          canComment={canComment}
          canDeleteAny={canDeleteAnyComment}
        />
      </Card>
    </article>
  );
}
