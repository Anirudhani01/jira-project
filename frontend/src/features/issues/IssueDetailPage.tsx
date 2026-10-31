import { MoreHorizontal, Pencil } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';

import { NotFoundPage } from '../../app/pages/NotFoundPage';
import { Button, IconButton } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../components/ui/Overlay';
import { useToast } from '../../components/ui/Toast';
import { formatRelativeTime } from '../../lib/relativeTime';
import { FormError } from '../../components/ui/Form';
import { StatusLozenge } from '../../components/ui/IssueIcons';
import { Input } from '../../components/ui/Input';
import { ErrorState, LoadingState } from '../../components/ui/States';
import { ApiError } from '../../lib/api/errors';
import type { Issue } from '../../lib/api/types';
import { useAppOnline } from '../../app/OnlineStatusProvider';
import { describeError } from '../../lib/forms';
import { permissionDeniedInlineMessage } from '../../lib/ux/permissionDenied';
import { discardIssueFieldDraft, loadIssueFieldDrafts } from '../../lib/ux/draftStorage';
import type { IssueFieldDraftPayload } from '../../lib/ux/draftTypes';
import { registerIssueDetailDraftSnapshot } from '../../lib/ux/issueDetailDraft';
import { useSession } from '../auth/api';
import { StoryPointsField } from './StoryPointsField';
import { IssueActivitySection } from './IssueActivitySection';
import { IssueChildrenSection } from './IssueChildrenSection';
import { IssueDescriptionSection } from './IssueDescriptionSection';
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
import {
  issueDetailLinkProps,
  issueDetailPath,
  readIssueDetailModalState,
} from './issueDetailNavigation';

type Field = 'summary' | 'description';

function SidebarField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-fg-muted">{label}</p>
      <div className="min-h-8 text-sm">{children}</div>
    </div>
  );
}

const OFFLINE_SAVE_HINT = 'Reconnect to save changes to the server.';

function InlineEditPanel({
  children,
  onSave,
  onCancel,
  saving,
  saveDisabled,
  saveDisabledHint,
}: {
  children: ReactNode;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  saveDisabled?: boolean;
  saveDisabledHint?: string | null;
}) {
  return (
    <div className="rounded-lg border border-line bg-surface p-4 shadow-sm ring-1 ring-accent/10 sm:p-5">
      <div className="space-y-4">{children}</div>
      <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-line pt-4">
        {saveDisabledHint ? (
          <p className="mr-auto text-sm text-fg-muted" role="status">
            {saveDisabledHint}
          </p>
        ) : null}
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
export function IssueDetailPage({ presentation = 'page' }: { presentation?: 'page' | 'modal' }) {
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
      presentation={presentation}
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
  presentation,
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
  presentation: 'page' | 'modal';
  canEdit: boolean;
  canDelete: boolean;
  canAssign: boolean;
  canTransition: boolean;
  canComment: boolean;
  canDeleteAnyComment: boolean;
  onReload: () => void;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const session = useSession();
  const online = useAppOnline();
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
  const [deleteOpen, setDeleteOpen] = useState(false);
  const toast = useToast();
  const conflictNotified = useRef(false);
  const conflict = update.error instanceof ApiError && update.error.status === 412;
  const [restoreOffer, setRestoreOffer] = useState<IssueFieldDraftPayload | null>(null);
  const [dismissedRestoreKey, setDismissedRestoreKey] = useState<string | null>(null);

  useEffect(() => {
    registerIssueDetailDraftSnapshot(() => {
      if (editing !== 'summary' && editing !== 'description') return null;
      const serverValue = editing === 'summary' ? issue.summary : (issue.description ?? '');
      if (draft === serverValue) return null;
      return {
        org,
        issueKey: issue.key,
        field: editing,
        value: draft,
        baseVersion: issue.version,
      };
    });
    return () => {
      registerIssueDetailDraftSnapshot(null);
    };
  }, [draft, editing, issue.description, issue.key, issue.summary, issue.version, org]);

  useEffect(() => {
    if (editing !== null) return;
    const stored = loadIssueFieldDrafts().find(
      (entry) => entry.org === org && entry.issueKey === issue.key,
    );
    if (!stored) return;
    if (issue.version > stored.baseVersion) {
      discardIssueFieldDraft(org, issue.key, stored.field);
      return;
    }
    const key = `${stored.org}:${stored.issueKey}:${stored.field}`;
    if (dismissedRestoreKey === key) return;
    queueMicrotask(() => {
      setRestoreOffer(stored);
    });
  }, [dismissedRestoreKey, editing, issue.key, issue.version, org]);

  useEffect(() => {
    if (conflict) {
      if (!conflictNotified.current) {
        toast({
          title: 'Updated by someone else',
          description: 'Your edit was not saved. Reload to see the latest version.',
          variant: 'error',
        });
        conflictNotified.current = true;
      }
      return;
    }
    conflictNotified.current = false;
  }, [conflict, toast]);

  const start = (field: Field, value: string) => {
    update.reset();
    setEditing(field);
    setDraft(value);
  };
  const save = (field: Field) => {
    if (!online) return;
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
    if (labelDraft === null || !online) return;
    update.mutate(
      { changes: { label_ids: labelDraft }, version: issue.version },
      {
        onSuccess: () => {
          setLabelDraft(null);
        },
      },
    );
  };

  const deleteIssue = () => {
    remove.mutate(undefined, {
      onSuccess: () => {
        setDeleteOpen(false);
        const modal = readIssueDetailModalState(location.state);
        if (modal) {
          const { pathname, search, hash } = modal.backgroundLocation;
          void navigate(`${pathname}${search}${hash}`, { replace: true, state: null });
          return;
        }
        void navigate(`/o/${org}/p/${issue.project_key}/issues`);
      },
    });
  };

  const childItems = children.data?.items ?? [];
  const childDone = children.data?.done ?? 0;
  const childTotal = children.data?.total ?? 0;

  const applyRestore = (offer: IssueFieldDraftPayload) => {
    start(offer.field, offer.value);
    discardIssueFieldDraft(org, issue.key, offer.field);
    setDismissedRestoreKey(`${offer.org}:${offer.issueKey}:${offer.field}`);
    setRestoreOffer(null);
  };

  return (
    <article aria-labelledby="issue-title" className="w-full space-y-6">
      {restoreOffer ? (
        <section
          role="region"
          aria-labelledby="issue-draft-restore-title"
          className="rounded-lg border border-line bg-surface-2 px-4 py-3 text-sm"
        >
          <h2 id="issue-draft-restore-title" className="font-semibold text-fg">
            Unsaved edits from before sign-in
          </h2>
          <p className="mt-1 text-fg-muted">
            Restore your previous {restoreOffer.field} draft, then press Save to update the issue.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => {
                applyRestore(restoreOffer);
              }}
            >
              Restore draft
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                discardIssueFieldDraft(org, issue.key, restoreOffer.field);
                setDismissedRestoreKey(
                  `${restoreOffer.org}:${restoreOffer.issueKey}:${restoreOffer.field}`,
                );
                setRestoreOffer(null);
              }}
            >
              Discard
            </Button>
          </div>
        </section>
      ) : null}
      {!online ? (
        <p role="status" className="text-sm text-fg-muted">
          You are offline. You can keep editing locally, but saving requires a connection.
        </p>
      ) : null}
      {presentation === 'page' ? (
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
      ) : null}

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
        <FormError>
          {update.error
            ? (permissionDeniedInlineMessage(update.error, 'issue-mutation') ??
              describeError(update.error))
            : null}
        </FormError>
      )}
      <FormError>
        {remove.error
          ? (permissionDeniedInlineMessage(remove.error, 'issue-mutation') ??
            describeError(remove.error))
          : null}
      </FormError>

      <header className="space-y-2">
        <p className="font-mono text-xs font-medium uppercase tracking-wide text-fg-subtle">
          {issue.key}
        </p>
        {editing === 'summary' ? (
          <InlineEditPanel
            saving={update.isPending}
            saveDisabled={!draft.trim() || !online}
            saveDisabledHint={!online ? OFFLINE_SAVE_HINT : null}
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
                  if (draft.trim() && online && !update.isPending) save('summary');
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
              {...(presentation === 'modal'
                ? issueDetailLinkProps(org, issue.parent.key, location)
                : { to: issueDetailPath(org, issue.parent.key) })}
            >
              {issue.parent.key} {issue.parent.summary}
            </Link>
          </p>
        ) : null}
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_17.5rem] lg:items-start">
        <div className="min-w-0 space-y-6">
          <Card className="p-5 sm:p-6">
            <IssueDescriptionSection
              description={issue.description}
              canEdit={canEdit}
              saving={update.isPending}
              saveDisabled={!online}
              saveDisabledHint={!online ? OFFLINE_SAVE_HINT : null}
              editing={editing === 'description'}
              draft={draft}
              onStartEdit={() => {
                start('description', issue.description ?? '');
              }}
              onDraftChange={setDraft}
              onSave={() => {
                save('description');
              }}
              onCancel={cancelEdit}
            />
          </Card>

          {childTotal > 0 ? (
            <Card className="p-5 sm:p-6">
              <IssueChildrenSection
                org={org}
                presentation={presentation}
                items={childItems}
                done={childDone}
                total={childTotal}
              />
            </Card>
          ) : null}

          <Card className="p-5 sm:p-6">
            <IssueActivitySection
              org={org}
              issueKey={issue.key}
              currentUserId={session.data?.user.id ?? ''}
              canComment={canComment}
              canDeleteAny={canDeleteAnyComment}
            />
          </Card>
        </div>

        <aside className="min-w-0 space-y-4 lg:sticky lg:top-2">
          <Card className="space-y-4 p-4">
            <div className="[&_button]:flex [&_button]:w-full [&_button]:justify-between">
              <SidebarField label="Status">
                {canTransition ? (
                  <IssueListStatusMenu org={org} issue={issue} canTransition={canTransition} />
                ) : (
                  <StatusLozenge name={issue.status.name} category={issue.status.category} />
                )}
              </SidebarField>
            </div>
            <SidebarField label="Type">
              <IssueListTypeMenu
                org={org}
                issue={issue}
                types={types.data ?? []}
                canEdit={canEdit}
              />
            </SidebarField>
            <SidebarField label="Priority">
              <IssueListPriorityMenu
                org={org}
                issue={issue}
                priorities={priorities.data ?? []}
                canEdit={canEdit}
                containedMenu={presentation === 'modal'}
              />
            </SidebarField>
            <SidebarField label="Story points">
              <StoryPointsField org={org} issue={issue} canEdit={canEdit} />
            </SidebarField>
            <SidebarField label="Assignee">
              <IssueListAssigneeMenu
                org={org}
                issue={issue}
                members={members.data ?? []}
                canAssign={canAssign}
              />
            </SidebarField>
            <SidebarField label="Reporter">
              <IssueListReporterMenu
                org={org}
                issue={issue}
                members={members.data ?? []}
                canEdit={canEdit}
              />
            </SidebarField>
            {issue.sprint ? (
              <SidebarField label="Sprint">
                <span className="text-fg">{issue.sprint.name}</span>
              </SidebarField>
            ) : null}
            <SidebarField label="Created">
              <time className="text-fg-muted" dateTime={issue.created_at}>
                {formatRelativeTime(issue.created_at)}
              </time>
            </SidebarField>
            <SidebarField label="Last updated">
              <time className="text-fg-muted" dateTime={issue.updated_at}>
                {formatRelativeTime(issue.updated_at)}
              </time>
            </SidebarField>
          </Card>

          <Card className="space-y-3 p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 id="labels-title" className="text-sm font-semibold text-fg">
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
                  <span className="text-sm text-fg-muted">None</span>
                ) : (
                  currentLabels.map((l) => (
                    <span
                      key={l.id}
                      className="rounded-full px-2.5 py-0.5 text-xs font-medium text-fg"
                      style={{
                        backgroundColor: `${l.color}33`,
                        borderLeft: `3px solid ${l.color}`,
                      }}
                    >
                      {l.name}
                    </span>
                  ))
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex max-h-40 flex-col gap-2 overflow-y-auto">
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
                <div className="flex flex-wrap items-center gap-2">
                  {!online ? (
                    <p className="w-full text-sm text-fg-muted" role="status">
                      {OFFLINE_SAVE_HINT}
                    </p>
                  ) : null}
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    disabled={update.isPending || !online}
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

          {canDelete ? (
            <div className="flex justify-end">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <IconButton label="Issue actions" size="sm">
                    <MoreHorizontal className="size-4" aria-hidden="true" />
                  </IconButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    className="text-danger focus:text-danger"
                    onSelect={() => {
                      setDeleteOpen(true);
                    }}
                  >
                    Delete issue
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ) : null}
        </aside>
      </div>

      {canDelete ? (
        <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
          <DialogContent
            title={`Delete ${issue.key}?`}
            description="This cannot be undone. Child issues may also be removed depending on type."
          >
            <div className="flex justify-end gap-2">
              <DialogClose asChild>
                <Button type="button" variant="ghost" size="sm">
                  Cancel
                </Button>
              </DialogClose>
              <Button
                type="button"
                variant="danger"
                size="sm"
                disabled={remove.isPending}
                onClick={deleteIssue}
              >
                {remove.isPending ? 'Deleting…' : 'Delete'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </article>
  );
}
