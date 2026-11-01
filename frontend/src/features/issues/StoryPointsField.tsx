import { useState, type SyntheticEvent } from 'react';

import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { useToast } from '../../components/ui/Toast';
import { ApiError } from '../../lib/api/errors';
import type { Issue } from '../../lib/api/types';
import {
  canSubmitStoryPointsChange,
  parseStoryPointsInput,
  storyPointsMutationFieldMessage,
  storyPointsRangeMessage,
} from '../storyPoints/storyPointsIssueUx';
import { StoryPointsDisabledHint } from '../storyPoints/StoryPointsPolicyHint';
import { isPolicyReady, useIssueStoryPointsPolicy } from '../storyPoints/useIssueStoryPointsPolicy';

import { useUpdateIssue } from './api';

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
  const policy = useIssueStoryPointsPolicy(org, issue.project_key);
  const update = useUpdateIssue(org, issue.key);
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const value = issue.story_points;

  const readyPolicy = isPolicyReady(policy) ? policy : null;
  const canOpenEditor =
    canEdit &&
    policy.status !== 'loading' &&
    (policy.status === 'conflict'
      ? value !== null
      : readyPolicy?.effectiveEnabled || value !== null);

  const inputMax = readyPolicy?.effectiveMax ?? 100;

  const start = () => {
    setDraft(value === null ? '' : String(value));
    setError(null);
    setEditing(true);
  };
  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    const parsed = parseStoryPointsInput(draft);
    const decision = canSubmitStoryPointsChange({
      current: value,
      parsed,
      policy: readyPolicy,
      settingsConflict: policy.status === 'conflict',
    });
    if (!decision.allowed) {
      setError(decision.reason);
      return;
    }
    if (decision.next === value) {
      setEditing(false);
      return;
    }
    update.mutate(
      { changes: { story_points: decision.next }, version: issue.version },
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
            const mapped = storyPointsMutationFieldMessage(failure);
            setError(
              mapped ??
                (failure instanceof ApiError ? failure.message : storyPointsRangeMessage(inputMax)),
            );
          }
        },
      },
    );
  };

  if (!editing) {
    const label = value === null ? 'None' : String(value);
    return (
      <div className="space-y-1">
        {canOpenEditor ? (
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
        )}
        {readyPolicy && !readyPolicy.effectiveEnabled && value !== null ? (
          <StoryPointsDisabledHint />
        ) : null}
      </div>
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
          max={inputMax}
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
      {policy.status === 'conflict' ? (
        <p className="text-xs text-fg-muted">You can clear the estimate; other changes may be blocked.</p>
      ) : null}
      {readyPolicy && !readyPolicy.effectiveEnabled ? (
        <StoryPointsDisabledHint />
      ) : null}
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
    </form>
  );
}
