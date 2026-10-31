import { useState, type SyntheticEvent } from 'react';

import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { useToast } from '../../components/ui/Toast';
import { ApiError } from '../../lib/api/errors';
import type { Issue } from '../../lib/api/types';

import { useUpdateIssue } from './api';
import { POINTS_ERROR, validPoints } from './CreateIssueDialog';

/** Story-point estimate in the details panel: click to edit, Enter or Save to apply, Esc to
 * cancel, empty clears it. A stale version (412) is reported and nothing is overwritten. */
export function StoryPointsField({
  org,
  issue,
  canEdit,
}: {
  org: string;
  issue: Issue;
  canEdit: boolean;
}) {
  const update = useUpdateIssue(org, issue.key);
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const value = issue.story_points;

  const start = () => {
    setDraft(value === null ? '' : String(value));
    setError(null);
    setEditing(true);
  };
  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    if (!validPoints(draft)) {
      setError(POINTS_ERROR);
      return;
    }
    const next = draft.trim() === '' ? null : Number(draft);
    if (next === value) {
      setEditing(false);
      return;
    }
    update.mutate(
      { changes: { story_points: next }, version: issue.version },
      {
        onSuccess: () => {
          setEditing(false);
        },
        onError: (failure) => {
          if (failure instanceof ApiError && failure.status === 412) {
            toast({
              title: 'Updated by someone else',
              description: 'Your estimate was not saved. Reload to see the latest version.',
              variant: 'error',
            });
            setEditing(false);
          } else {
            setError(failure instanceof ApiError ? failure.message : POINTS_ERROR);
          }
        },
      },
    );
  };

  if (!editing) {
    const label = value === null ? 'None' : String(value);
    return canEdit ? (
      <button
        type="button"
        onClick={start}
        aria-label={`Story points: ${label}. Edit`}
        className="w-full rounded px-1 py-0.5 text-left hover:bg-surface-hover"
      >
        {label}
      </button>
    ) : (
      <span>{label}</span>
    );
  }
  return (
    <form onSubmit={submit} noValidate className="space-y-1">
      <div className="flex gap-2">
        <Input
          autoFocus
          type="number"
          inputMode="numeric"
          min={0}
          max={100}
          step={1}
          aria-label="Story points"
          aria-invalid={error ? true : undefined}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setEditing(false);
          }}
        />
        <Button type="submit" variant="primary" size="sm" disabled={update.isPending}>
          Save
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
    </form>
  );
}
