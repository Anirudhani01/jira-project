import { useState, type SyntheticEvent } from 'react';

import { Button } from '../../components/ui/Button';
import { FormError } from '../../components/ui/Form';
import { ErrorState, LoadingState } from '../../components/ui/States';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/Overlay';
import { formatRelativeTime } from '../../lib/relativeTime';
import { describeError } from '../../lib/forms';
import { permissionDeniedInlineMessage } from '../../lib/ux/permissionDenied';
import type { Comment, IssueActivity } from '../../lib/api/types';
import { useLocation } from 'react-router';
import { useIssueActivity } from './api';

import { useComments, useCreateComment, useDeleteComment, useUpdateComment } from '../comments/api';
import { mergeTimeline, type TimelineEntry } from '../comments/timeline';

import { describeIssueActivity } from './activityFormat';

function commentMutationError(error: unknown): string | null {
  if (!error) return null;
  return permissionDeniedInlineMessage(error, 'issue-mutation') ?? describeError(error);
}

function ActivityRow({ activity }: { activity: IssueActivity }) {
  const actor = activity.actor?.display_name ?? 'System';
  return (
    <li className="text-sm text-fg">
      <span className="font-medium">{actor}</span>{' '}
      <span className="text-fg-muted">{describeIssueActivity(activity)}</span>
      <span className="text-fg-subtle"> · </span>
      <time className="text-fg-muted" dateTime={activity.created_at}>
        {formatRelativeTime(activity.created_at)}
      </time>
    </li>
  );
}

function CommentRow({
  comment,
  currentUserId,
  canDeleteAny,
  editingId,
  editDraft,
  updateError,
  updatePending,
  onStartEdit,
  onEditDraftChange,
  onSaveEdit,
  onCancelEdit,
  onDelete,
}: {
  comment: Comment;
  currentUserId: string;
  canDeleteAny: boolean;
  editingId: string | null;
  editDraft: string;
  updateError: unknown;
  updatePending: boolean;
  onStartEdit: (id: string, body: string) => void;
  onEditDraftChange: (value: string) => void;
  onSaveEdit: (id: string) => void;
  onCancelEdit: () => void;
  onDelete: (id: string) => void;
}) {
  const isEditing = editingId === comment.id;
  const anchor = `comment-${comment.id}`;
  const { hash } = useLocation();
  const target = hash === `#${anchor}`;
  return (
    <li
      id={anchor}
      ref={(node) => {
        if (target && node) node.scrollIntoView({ block: 'center' });
      }}
      className={`rounded-lg border bg-surface-raised p-3 text-sm ${target ? 'border-accent ring-1 ring-accent' : 'border-line'}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium text-fg">{comment.author.display_name}</span>
        <time className="text-xs text-fg-muted" dateTime={comment.created_at}>
          {formatRelativeTime(comment.created_at)}
          {comment.edited_at ? ' · edited' : ''}
        </time>
      </div>
      {isEditing ? (
        <div className="mt-2 space-y-2">
          <textarea
            aria-label="Edit comment"
            className="w-full rounded-md border border-line-strong bg-surface px-2.5 py-1.5 text-sm"
            rows={3}
            maxLength={32000}
            value={editDraft}
            onChange={(e) => {
              onEditDraftChange(e.target.value);
            }}
          />
          <FormError>{commentMutationError(updateError)}</FormError>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="primary"
              disabled={updatePending}
              onClick={() => {
                onSaveEdit(comment.id);
              }}
            >
              Save
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={onCancelEdit}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div
            className="prose prose-sm mt-2 max-w-none text-fg"
            dangerouslySetInnerHTML={{ __html: comment.body_html }}
          />
          <div className="mt-2 flex gap-3 text-xs">
            {comment.author.id === currentUserId ? (
              <button
                type="button"
                className="font-medium text-accent hover:underline"
                onClick={() => {
                  onStartEdit(comment.id, comment.body);
                }}
              >
                Edit
              </button>
            ) : null}
            {comment.author.id === currentUserId || canDeleteAny ? (
              <button
                type="button"
                className="font-medium text-danger hover:underline"
                onClick={() => {
                  onDelete(comment.id);
                }}
              >
                Delete
              </button>
            ) : null}
          </div>
        </>
      )}
    </li>
  );
}

function TimelineList({
  entries,
  ...commentProps
}: {
  entries: TimelineEntry[];
  currentUserId: string;
  canDeleteAny: boolean;
  editingId: string | null;
  editDraft: string;
  updateError: unknown;
  updatePending: boolean;
  onStartEdit: (id: string, body: string) => void;
  onEditDraftChange: (value: string) => void;
  onSaveEdit: (id: string) => void;
  onCancelEdit: () => void;
  onDelete: (id: string) => void;
}) {
  if (entries.length === 0) {
    return <p className="text-sm text-fg-muted">No activity yet.</p>;
  }
  return (
    <ol className="space-y-3">
      {entries.map((entry) =>
        entry.kind === 'activity' ? (
          <ActivityRow key={entry.key} activity={entry.activity} />
        ) : (
          <CommentRow
            key={entry.key}
            comment={entry.comment}
            currentUserId={commentProps.currentUserId}
            canDeleteAny={commentProps.canDeleteAny}
            editingId={commentProps.editingId}
            editDraft={commentProps.editDraft}
            updateError={commentProps.updateError}
            updatePending={commentProps.updatePending}
            onStartEdit={commentProps.onStartEdit}
            onEditDraftChange={commentProps.onEditDraftChange}
            onSaveEdit={commentProps.onSaveEdit}
            onCancelEdit={commentProps.onCancelEdit}
            onDelete={commentProps.onDelete}
          />
        ),
      )}
    </ol>
  );
}

function CommentComposer({
  canComment,
  draft,
  createError,
  createPending,
  onDraftChange,
  onSubmit,
}: {
  canComment: boolean;
  draft: string;
  createError: unknown;
  createPending: boolean;
  onDraftChange: (value: string) => void;
  onSubmit: (event: SyntheticEvent) => void;
}) {
  if (!canComment) return null;
  return (
    <form onSubmit={onSubmit} className="space-y-2 border-t border-line pt-4">
      <label className="block text-sm font-medium text-fg" htmlFor="new-comment">
        Add a comment
      </label>
      <textarea
        id="new-comment"
        data-shortcut-target="comment"
        className="w-full rounded-md border border-line-strong bg-surface px-2.5 py-1.5 text-sm"
        rows={3}
        maxLength={32000}
        value={draft}
        onChange={(e) => {
          onDraftChange(e.target.value);
        }}
      />
      <FormError>{commentMutationError(createError)}</FormError>
      <Button type="submit" variant="primary" size="sm" disabled={createPending || !draft.trim()}>
        Comment
      </Button>
    </form>
  );
}

function LoadMoreRow({
  activity,
  comments,
  tab,
}: {
  activity: ReturnType<typeof useIssueActivity>;
  comments: ReturnType<typeof useComments>;
  tab: 'all' | 'comments' | 'history';
}) {
  const showActivity = tab !== 'comments' && activity.hasNextPage;
  const showComments = tab !== 'history' && comments.hasNextPage;
  if (!showActivity && !showComments) return null;
  return (
    <div className="flex flex-wrap gap-3 pt-2">
      {showActivity ? (
        <Button
          type="button"
          variant="link"
          size="sm"
          className="h-auto px-0"
          disabled={activity.isFetchingNextPage}
          onClick={() => void activity.fetchNextPage()}
        >
          Load more history
        </Button>
      ) : null}
      {showComments ? (
        <Button
          type="button"
          variant="link"
          size="sm"
          className="h-auto px-0"
          disabled={comments.isFetchingNextPage}
          onClick={() => void comments.fetchNextPage()}
        >
          Load more comments
        </Button>
      ) : null}
    </div>
  );
}

/** PR 5c — All / Comments / History tabs over the merged issue timeline. */
export function IssueActivitySection({
  org,
  issueKey,
  currentUserId,
  canComment,
  canDeleteAny,
}: {
  org: string;
  issueKey: string;
  currentUserId: string;
  canComment: boolean;
  canDeleteAny: boolean;
}) {
  const activity = useIssueActivity(org, issueKey);
  const comments = useComments(org, issueKey);
  const create = useCreateComment(org, issueKey);
  const update = useUpdateComment(org, issueKey);
  const remove = useDeleteComment(org, issueKey);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [tab, setTab] = useState<'all' | 'comments' | 'history'>('all');

  const activityItems = (activity.data?.pages ?? []).flatMap((page) => page.items);
  const commentItems = (comments.data?.pages ?? []).flatMap((page) => page.items);
  const timeline = mergeTimeline(activityItems, commentItems);

  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    if (!draft.trim()) return;
    create.mutate(
      { body: draft, idempotencyKey },
      {
        onSuccess: () => {
          setDraft('');
          setIdempotencyKey(crypto.randomUUID());
        },
      },
    );
  };

  const commentRowProps = {
    currentUserId,
    canDeleteAny,
    editingId,
    editDraft,
    updateError: update.error,
    updatePending: update.isPending,
    onStartEdit: (id: string, body: string) => {
      update.reset();
      setEditingId(id);
      setEditDraft(body);
    },
    onEditDraftChange: setEditDraft,
    onSaveEdit: (id: string) => {
      update.mutate(
        { id, body: editDraft },
        {
          onSuccess: () => {
            setEditingId(null);
          },
        },
      );
    },
    onCancelEdit: () => {
      setEditingId(null);
    },
    onDelete: (id: string) => {
      if (window.confirm('Delete this comment?')) {
        remove.mutate(id);
      }
    },
  };

  const loading = activity.isPending || comments.isPending;

  return (
    <section aria-labelledby="activity-title" className="space-y-4">
      <h2 id="activity-title" className="text-base font-semibold text-fg">
        Activity
      </h2>
      {loading ? <LoadingState label="Loading activity" /> : null}
      {activity.isError ? (
        <ErrorState error={activity.error} onRetry={() => void activity.refetch()} />
      ) : null}
      {comments.isError ? (
        <ErrorState error={comments.error} onRetry={() => void comments.refetch()} />
      ) : null}

      <Tabs
        value={tab}
        onValueChange={(v) => {
          setTab(v as typeof tab);
        }}
      >
        <TabsList aria-label="Activity views">
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="comments">Comments</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>
        <TabsContent value="all" className="pt-4">
          <TimelineList entries={timeline} {...commentRowProps} />
          <LoadMoreRow activity={activity} comments={comments} tab="all" />
          <CommentComposer
            canComment={canComment}
            draft={draft}
            createError={create.error}
            createPending={create.isPending}
            onDraftChange={setDraft}
            onSubmit={submit}
          />
        </TabsContent>
        <TabsContent value="comments" className="pt-4">
          <TimelineList
            entries={timeline.filter((e) => e.kind === 'comment')}
            {...commentRowProps}
          />
          <LoadMoreRow activity={activity} comments={comments} tab="comments" />
          <CommentComposer
            canComment={canComment}
            draft={draft}
            createError={create.error}
            createPending={create.isPending}
            onDraftChange={setDraft}
            onSubmit={submit}
          />
        </TabsContent>
        <TabsContent value="history" className="pt-4">
          <TimelineList
            entries={timeline.filter((e) => e.kind === 'activity')}
            {...commentRowProps}
          />
          <LoadMoreRow activity={activity} comments={comments} tab="history" />
        </TabsContent>
      </Tabs>
    </section>
  );
}
