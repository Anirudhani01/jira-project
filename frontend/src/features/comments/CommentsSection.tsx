import { useState, type SyntheticEvent } from 'react';

import { FormError } from '../../components/ui/Form';
import { ApiError } from '../../lib/api/errors';
import type { IssueActivity } from '../../lib/api/types';
import { describeError } from '../../lib/forms';

import { useComments, useCreateComment, useDeleteComment, useUpdateComment } from './api';

/** Comments + field-change activity, merged into one chronological timeline (plan M8 AC).
 * Ties at the same instant are broken by putting activity entries first -- a fixed,
 * deterministic rule, not insertion order from two independently-fetched lists. */
export function CommentsSection({
  org,
  issueKey,
  activity,
  currentUserId,
  canComment,
  canDeleteAny,
}: {
  org: string;
  issueKey: string;
  activity: IssueActivity[];
  currentUserId: string;
  canComment: boolean;
  canDeleteAny: boolean;
}) {
  const comments = useComments(org, issueKey);
  const create = useCreateComment(org, issueKey);
  const update = useUpdateComment(org, issueKey);
  const remove = useDeleteComment(org, issueKey);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');

  const items = (comments.data?.pages ?? []).flatMap((page) => page.items);

  type Entry =
    | { kind: 'activity'; at: string; activity: IssueActivity }
    | { kind: 'comment'; at: string; comment: (typeof items)[number] };
  const timeline: Entry[] = [
    ...activity.map((a): Entry => ({ kind: 'activity', at: a.created_at, activity: a })),
    ...items.map((c): Entry => ({ kind: 'comment', at: c.created_at, comment: c })),
  ].sort((a, b) => a.at.localeCompare(b.at));

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
      <ol className="space-y-3 text-sm">
        {timeline.map((entry) =>
          entry.kind === 'activity' ? (
            <li key={`activity-${entry.activity.id}`}>
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
            <li key={entry.comment.id} className="rounded border border-slate-200 p-3">
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
      {comments.hasNextPage ? (
        <button
          type="button"
          className="text-sm text-blue-700 underline"
          onClick={() => void comments.fetchNextPage()}
        >
          Load earlier comments
        </button>
      ) : null}
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
