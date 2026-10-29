import { useState, type SyntheticEvent } from 'react';

import { ErrorState, LoadingState } from '../../components/ui/States';
import { FormError } from '../../components/ui/Form';
import { ApiError } from '../../lib/api/errors';
import { describeError } from '../../lib/forms';
import { useIssueActivity } from '../issues/api';

import { useComments, useCreateComment, useDeleteComment, useUpdateComment } from './api';
import { mergeTimeline } from './timeline';

/** Comments + field-change activity, merged into one chronological timeline (plan M8 AC).
 * Both lists are independently cursor-paginated (same contract as `GET .../comments` and
 * `GET .../activity`); `mergeTimeline` combines whatever pages have been loaded so far,
 * so "Load more" on either list fetches the next chronological page (via `next_cursor`)
 * and extends the merged view without losing or duplicating entries. See `./timeline.ts`
 * for the ordering/dedup rules. */
export function CommentsSection({
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

  const activityItems = (activity.data?.pages ?? []).flatMap((page) => page.items);
  const items = (comments.data?.pages ?? []).flatMap((page) => page.items);
  const timeline = mergeTimeline(activityItems, items);

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

  const startEdit = (id: string, body: string) => {
    update.reset();
    setEditingId(id);
    setEditDraft(body);
  };

  return (
    <section aria-labelledby="activity-title" className="space-y-4">
      <h2 id="activity-title" className="text-lg font-semibold">
        Activity
      </h2>
      {activity.isPending || comments.isPending ? <LoadingState label="Loading activity" /> : null}
      {activity.isError ? (
        <ErrorState error={activity.error} onRetry={() => void activity.refetch()} />
      ) : null}
      {comments.isError ? (
        <ErrorState error={comments.error} onRetry={() => void comments.refetch()} />
      ) : null}
      <ol className="space-y-3 text-sm">
        {timeline.map((entry) =>
          entry.kind === 'activity' ? (
            <li key={entry.key}>
              {entry.activity.actor?.display_name ?? 'System'}{' '}
              {entry.activity.action === 'updated'
                ? `changed ${entry.activity.field ?? ''}`
                : entry.activity.action === 'transitioned'
                  ? 'changed status'
                  : entry.activity.action}{' '}
              ·{' '}
              <time dateTime={entry.activity.created_at}>
                {new Date(entry.activity.created_at).toLocaleString()}
              </time>
            </li>
          ) : (
            <li key={entry.key} className="rounded border border-slate-200 p-3">
              <div className="flex items-center justify-between">
                <span className="font-medium">{entry.comment.author.display_name}</span>
                <time dateTime={entry.comment.created_at} className="text-xs text-slate-500">
                  {new Date(entry.comment.created_at).toLocaleString()}
                  {entry.comment.edited_at ? ' (edited)' : ''}
                </time>
              </div>
              {editingId === entry.comment.id ? (
                <div className="mt-2 space-y-2">
                  <textarea
                    aria-label="Edit comment"
                    className="w-full rounded border border-slate-300 px-2 py-1"
                    rows={3}
                    maxLength={32000}
                    value={editDraft}
                    onChange={(e) => {
                      setEditDraft(e.target.value);
                    }}
                  />
                  <FormError>{update.error ? describeError(update.error) : null}</FormError>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      className="rounded bg-blue-700 px-3 py-1 text-white"
                      disabled={update.isPending}
                      onClick={() => {
                        update.mutate(
                          { id: entry.comment.id, body: editDraft },
                          {
                            onSuccess: () => {
                              setEditingId(null);
                            },
                          },
                        );
                      }}
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      className="underline"
                      onClick={() => {
                        setEditingId(null);
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div
                    className="prose prose-sm mt-1 max-w-none"
                    // The backend renders Markdown and sanitizes it server-side
                    // (no raw HTML, URL-scheme allowlist) before this ever reaches the
                    // client -- see app/core/markdown.py. Never render `body` itself.
                    dangerouslySetInnerHTML={{ __html: entry.comment.body_html }}
                  />
                  <div className="mt-1 flex gap-3 text-xs">
                    {entry.comment.author.id === currentUserId ? (
                      <button
                        type="button"
                        className="text-blue-700 underline"
                        onClick={() => {
                          startEdit(entry.comment.id, entry.comment.body);
                        }}
                      >
                        Edit
                      </button>
                    ) : null}
                    {entry.comment.author.id === currentUserId || canDeleteAny ? (
                      <button
                        type="button"
                        className="text-red-700 underline"
                        onClick={() => {
                          if (window.confirm('Delete this comment?')) {
                            remove.mutate(entry.comment.id);
                          }
                        }}
                      >
                        Delete
                      </button>
                    ) : null}
                  </div>
                </>
              )}
            </li>
          ),
        )}
      </ol>
      <div className="flex gap-4">
        {activity.hasNextPage ? (
          <button
            type="button"
            className="text-sm text-blue-700 underline"
            disabled={activity.isFetchingNextPage}
            onClick={() => void activity.fetchNextPage()}
          >
            Load more activity
          </button>
        ) : null}
        {comments.hasNextPage ? (
          <button
            type="button"
            className="text-sm text-blue-700 underline"
            disabled={comments.isFetchingNextPage}
            onClick={() => void comments.fetchNextPage()}
          >
            Load more comments
          </button>
        ) : null}
      </div>
      {canComment ? (
        <form onSubmit={submit} className="space-y-2">
          <label className="block text-sm font-medium" htmlFor="new-comment">
            Add a comment
          </label>
          <textarea
            id="new-comment"
            className="w-full rounded border border-slate-300 px-2 py-1"
            rows={3}
            maxLength={32000}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
            }}
          />
          <FormError>
            {create.error instanceof ApiError ? describeError(create.error) : null}
          </FormError>
          <button
            type="submit"
            className="rounded bg-blue-700 px-3 py-1 text-white disabled:opacity-60"
            disabled={create.isPending || !draft.trim()}
          >
            Comment
          </button>
        </form>
      ) : null}
    </section>
  );
}
