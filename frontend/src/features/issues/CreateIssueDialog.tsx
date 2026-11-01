import { useMemo, useRef, useState, type SyntheticEvent } from 'react';
import { useNavigate } from 'react-router';

import { useAppOnline } from '../../app/OnlineStatusProvider';
import { Avatar } from '../../components/ui/Avatar';
import { Button } from '../../components/ui/Button';
import { Combobox, type ComboOption } from '../../components/ui/Combobox';
import { FormError, SubmitButton } from '../../components/ui/Form';
import { Field, Input, Textarea } from '../../components/ui/Input';
import { PriorityIcon, TypeIcon } from '../../components/ui/IssueIcons';
import { Dialog, DialogContent } from '../../components/ui/Overlay';
import { useToast } from '../../components/ui/Toast';
import { UxSlowHint } from '../../components/ux';
import { ApiError } from '../../lib/api/errors';
import {
  useFocusOnSubmitAttempt,
  type FocusableFieldRef,
} from '../../lib/ux/focusFirstInvalidControl';
import { createFeedbackInvocationId, showSuccessToast } from '../../lib/ux/mutationFeedback';
import { mutationErrorMessage } from '../../lib/ux/permissionDenied';
import { useSlowPending } from '../../lib/ux/useSlowPending';
import { useVersions } from '../backlog/planApi';
import { useProjectMembers } from '../projects/api';
import { StoryPointsConflictBanner } from '../storyPoints/StoryPointsPolicyHint';
import {
  clientStoryPointsInputError,
  parseStoryPointsInput,
  storyPointsMutationFieldMessage,
  STORY_POINTS_INPUT_INVALID,
} from '../storyPoints/storyPointsIssueUx';
import { isPolicyReady, useIssueStoryPointsPolicy } from '../storyPoints/useIssueStoryPointsPolicy';

import {
  useCreateIssue,
  useIssueSearch,
  useIssueTypes,
  useLabels,
  usePriorities,
  type IssueSearchHit,
} from './api';

type ClientErrors = { summary?: string; parent?: string; points?: string };

export const POINTS_ERROR = STORY_POINTS_INPUT_INVALID;

/** Empty means "no estimate"; otherwise a whole number 0-100 (legacy tests). */
export function validPoints(value: string): boolean {
  const parsed = parseStoryPointsInput(value);
  return parsed.kind !== 'invalid';
}

/** Create-issue modal. One Idempotency-Key per submission attempt: resubmitting after a lost
 * response replays the original issue instead of creating a second one. "Create another"
 * keeps the dialog open with the shared fields and a fresh key. */
export function CreateIssueDialog({
  org,
  project,
  onClose,
  defaultKind,
}: {
  org: string;
  project: string;
  onClose: () => void;
  /** Preselects the first issue type of this kind (e.g. `epic` from the Epics panel). */
  defaultKind?: string;
}) {
  const navigate = useNavigate();
  const online = useAppOnline();
  const toast = useToast();
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const types = useIssueTypes(org);
  const priorities = usePriorities(org);
  const members = useProjectMembers(org, project);
  const labels = useLabels(org, project);
  const versions = useVersions(org, project, false);
  const create = useCreateIssue(org, project);
  const policy = useIssueStoryPointsPolicy(org, project);
  const readyPolicy = isPolicyReady(policy) ? policy : null;

  const [summary, setSummary] = useState('');
  const [description, setDescription] = useState('');
  const [typeId, setTypeId] = useState<string | null>(null);
  const [priorityId, setPriorityId] = useState<string | null>(null);
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [parent, setParent] = useState<IssueSearchHit | null>(null);
  const [parentQuery, setParentQuery] = useState('');
  const [labelIds, setLabelIds] = useState<string[]>([]);
  const [fixVersionId, setFixVersionId] = useState<string | null>(null);
  const [points, setPoints] = useState('');
  const [another, setAnother] = useState(false);
  const [clientErrors, setClientErrors] = useState<ClientErrors>({});
  const [focusGeneration, setFocusGeneration] = useState(0);
  const summaryRef = useRef<HTMLInputElement>(null);
  const parentRef = useRef<HTMLButtonElement>(null);
  const pointsRef = useRef<HTMLInputElement>(null);

  const search = useIssueSearch(org, project, parentQuery);

  const issueTypes = types.data ?? [];
  const issuePriorities = priorities.data ?? [];

  const effectiveType =
    typeId ??
    (defaultKind ? issueTypes.find((t) => t.kind === defaultKind) : undefined)?.id ??
    (issueTypes.find((t) => t.name === 'Task') ?? issueTypes[0])?.id ??
    null;
  const effectivePriority =
    priorityId ??
    (issuePriorities.find((p) => p.name === 'Medium') ?? issuePriorities[0])?.id ??
    null;
  const selectedType = issueTypes.find((t) => t.id === effectiveType);
  const needsParent = selectedType?.kind === 'subtask';

  const serverFieldError = (field: string) =>
    create.error instanceof ApiError
      ? create.error.fieldErrors.find((e) => e.field === `body.${field}`)?.message
      : undefined;
  const summaryError = clientErrors.summary ?? serverFieldError('summary');
  const parentError = clientErrors.parent ?? serverFieldError('parent_id');
  const pointsError =
    clientErrors.points ??
    serverFieldError('story_points') ??
    (create.error ? storyPointsMutationFieldMessage(create.error) : undefined);

  const focusFields = useMemo(
    (): FocusableFieldRef[] => [
      { hasError: Boolean(summaryError), focus: () => summaryRef.current?.focus() },
      { hasError: Boolean(parentError), focus: () => parentRef.current?.focus() },
      { hasError: Boolean(pointsError), focus: () => pointsRef.current?.focus() },
    ],
    [parentError, pointsError, summaryError],
  );
  useFocusOnSubmitAttempt(focusGeneration, focusFields);

  const formFailure =
    create.error &&
    !(
      create.error instanceof ApiError &&
      create.error.status === 422 &&
      create.error.fieldErrors.length
    )
      ? mutationErrorMessage(create.error, 'issue-mutation')
      : null;
  const slow = useSlowPending(create.isPending);

  const showStoryPointsField =
    policy.status !== 'conflict' && readyPolicy?.effectiveEnabled === true;
  const storyPointsPending = policy.status === 'loading';
  const pointsMax = readyPolicy?.effectiveMax ?? 100;

  const parentOptions: ComboOption[] = useMemo(() => {
    const hits = [...(search.data ?? [])];
    if (parent && !hits.some((h) => h.key === parent.key)) hits.unshift(parent);
    return hits.map((hit) => ({
      value: hit.key,
      label: hit.key,
      description: hit.summary,
      icon: <TypeIcon kind={hit.type.kind} name={hit.type.name} />,
    }));
  }, [parent, search.data]);

  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    if (!effectiveType || !effectivePriority || !online || create.isPending) return;

    setClientErrors({});
    create.reset();

    const nextClient: ClientErrors = {};
    if (!summary.trim()) nextClient.summary = 'Enter a summary.';
    if (needsParent && !parent) nextClient.parent = 'Choose a parent issue for a sub-task.';
    if (policy.status === 'conflict' && points.trim() !== '') {
      nextClient.points =
        'Project estimate settings conflict with organization policy. Resolve on the Estimates tab first.';
    } else if (showStoryPointsField && points.trim() !== '') {
      const inputError = clientStoryPointsInputError(points, pointsMax);
      if (inputError) nextClient.points = inputError;
    } else if (points.trim() !== '' && readyPolicy && !readyPolicy.effectiveEnabled) {
      nextClient.points = 'Story points are not enabled for this project.';
    }
    if (Object.keys(nextClient).length > 0) {
      setClientErrors(nextClient);
      setFocusGeneration((g) => g + 1);
      return;
    }

    create.mutate(
      {
        idempotencyKey,
        body: {
          type_id: effectiveType,
          priority_id: effectivePriority,
          summary,
          ...(description ? { description } : {}),
          ...(assigneeId ? { assignee_id: assigneeId } : {}),
          ...(parent ? { parent_id: parent.id } : {}),
          ...(labelIds.length ? { label_ids: labelIds } : {}),
          ...(fixVersionId ? { fix_version_id: fixVersionId } : {}),
          ...(showStoryPointsField && points.trim() !== '' ? { story_points: Number(points) } : {}),
        },
      },
      {
        onSuccess: (issue) => {
          if (!another) {
            // Opening the new issue is the confirmation: no extra toast for this path. The
            // dialog may be owned by the shell (top bar, shortcuts), so it closes itself.
            onClose();
            void navigate(`/o/${org}/issues/${issue.key}`);
            return;
          }
          showSuccessToast(toast, {
            feedbackInvocationId: createFeedbackInvocationId(),
            title: `${issue.key} created`,
            description: issue.summary,
          });
          setSummary('');
          setDescription('');
          setPoints('');
          setClientErrors({});
          setIdempotencyKey(crypto.randomUUID());
          setFocusGeneration(0);
          summaryRef.current?.focus();
        },
        onError: () => {
          setFocusGeneration((g) => g + 1);
        },
      },
    );
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        title="Create issue"
        description={`New issue in project ${project}.`}
        className="w-[min(94vw,40rem)]"
      >
        <form onSubmit={submit} noValidate className="space-y-4">
          <FormError>{formFailure}</FormError>
          <Combobox
            label="Type"
            options={issueTypes.map((t) => ({
              value: t.id,
              label: t.name,
              icon: <TypeIcon kind={t.kind} name={t.name} />,
            }))}
            value={effectiveType}
            onChange={setTypeId}
            loading={types.isPending}
          />
          <Field label="Summary" error={summaryError ?? null}>
            {(props) => (
              <Input
                ref={summaryRef}
                maxLength={255}
                value={summary}
                onChange={(e) => {
                  setSummary(e.target.value);
                }}
                {...props}
              />
            )}
          </Field>
          <Field label="Description">
            {(props) => (
              <Textarea
                maxLength={32000}
                rows={4}
                value={description}
                onChange={(e) => {
                  setDescription(e.target.value);
                }}
                {...props}
              />
            )}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Combobox
              label="Priority"
              options={issuePriorities.map((p) => ({
                value: p.id,
                label: p.name,
                icon: <PriorityIcon name={p.name} />,
              }))}
              value={effectivePriority}
              onChange={setPriorityId}
              loading={priorities.isPending}
            />
            <Combobox
              label="Assignee"
              clearLabel="Unassigned"
              searchPlaceholder="Search people…"
              emptyText="No matching people"
              options={(members.data ?? []).map((m) => ({
                value: m.user_id,
                label: m.display_name,
                description: m.email,
                icon: <Avatar name={m.display_name} size="xs" />,
              }))}
              value={assigneeId}
              onChange={setAssigneeId}
              loading={members.isPending}
            />
          </div>
          <Combobox
            label={needsParent ? 'Parent (required for a sub-task)' : 'Parent (optional)'}
            clearLabel="No parent"
            searchPlaceholder="Search by key or summary…"
            emptyText={
              parentQuery.trim()
                ? `No issues match “${parentQuery.trim()}”`
                : 'No issues in this project yet'
            }
            options={parentOptions}
            value={parent?.key ?? null}
            onChange={(key) => {
              setParent(
                key === null
                  ? null
                  : (search.data?.find((hit) => hit.key === key) ??
                      (parent?.key === key ? parent : null)),
              );
            }}
            onSearch={setParentQuery}
            loading={search.isFetching}
            error={parentError ?? null}
            triggerRef={parentRef}
          />
          {(labels.data ?? []).length > 0 ? (
            <Combobox
              label="Labels"
              multiple
              placeholder="None"
              searchPlaceholder="Search labels…"
              options={(labels.data ?? []).map((l) => ({
                value: l.id,
                label: l.name,
                icon: (
                  <span
                    aria-hidden="true"
                    className="inline-block size-3 rounded-full"
                    style={{ backgroundColor: l.color }}
                  />
                ),
              }))}
              value={labelIds}
              onChange={setLabelIds}
            />
          ) : null}
          {(versions.data ?? []).length > 0 ? (
            <Combobox
              label="Fix version"
              clearLabel="No version"
              searchPlaceholder="Search versions…"
              options={(versions.data ?? []).map((v) => ({ value: v.id, label: v.name }))}
              value={fixVersionId}
              onChange={setFixVersionId}
            />
          ) : null}
          {policy.status === 'conflict' ? (
            <StoryPointsConflictBanner org={org} projectKey={project} />
          ) : null}
          {showStoryPointsField ? (
            <Field
              label="Story points (optional)"
              hint={`Whole numbers 0–${String(pointsMax)} for this project.`}
              error={pointsError ?? null}
            >
              {(props) => (
                <Input
                  ref={pointsRef}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={pointsMax}
                  step={1}
                  disabled={storyPointsPending}
                  value={points}
                  onChange={(e) => {
                    setPoints(e.target.value);
                  }}
                  {...props}
                />
              )}
            </Field>
          ) : storyPointsPending ? (
            <p className="text-sm text-fg-muted">Loading estimate policy…</p>
          ) : null}
          {!online ? (
            <p role="status" className="rounded-md bg-warning-soft px-3 py-2 text-sm text-warning">
              You are offline. Your input is kept; reconnect to create the issue.
            </p>
          ) : null}
          <UxSlowHint visible={slow} stage="Still creating the issue…" />
          <div className="flex items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={another}
                onChange={(e) => {
                  setAnother(e.target.checked);
                }}
              />
              Create another
            </label>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <SubmitButton pending={create.isPending} disabled={!online}>
                Create
              </SubmitButton>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
