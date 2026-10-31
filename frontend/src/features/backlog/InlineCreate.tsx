import { Plus } from 'lucide-react';
import { useRef, useState, type SyntheticEvent } from 'react';

import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { mutationErrorMessage } from '../../lib/ux/permissionDenied';
import { useCreateIssue, useIssueTypes, usePriorities } from '../issues/api';

import { useMoveToSprint, useRefresh } from './api';

/** "+ Create issue" at the foot of a panel. Enter creates a Task (Medium priority) and, for a
 * sprint panel, puts it in that sprint; the input stays open for quick entry. The new row
 * appearing in the list is the confirmation (no extra toast). */
export function InlineCreate({
  org,
  project,
  sprintId,
  online,
}: {
  org: string;
  project: string;
  sprintId: string | null;
  online: boolean;
}) {
  const types = useIssueTypes(org);
  const priorities = usePriorities(org);
  const create = useCreateIssue(org, project);
  const move = useMoveToSprint(org, project);
  const refresh = useRefresh(org, project);
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const typeId = (types.data?.find((t) => t.name === 'Task') ?? types.data?.[0])?.id;
  const priorityId = (priorities.data?.find((p) => p.name === 'Medium') ?? priorities.data?.[0])
    ?.id;

  const submit = async (event: SyntheticEvent) => {
    event.preventDefault();
    if (!online || busy || !typeId || !priorityId) return;
    if (!summary.trim()) {
      setError('Enter a summary.');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const issue = await create.mutateAsync({
        idempotencyKey: key,
        body: { type_id: typeId, priority_id: priorityId, summary: summary.trim() },
      });
      if (sprintId) {
        await move.mutateAsync({ key: issue.key, version: issue.version, sprintId });
      }
      await refresh(); // the new row appears in its panel; this is the confirmation
      setSummary('');
      setKey(crypto.randomUUID());
      inputRef.current?.focus();
    } catch (failure) {
      setError(mutationErrorMessage(failure, 'issue-mutation'));
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="m-1 justify-start"
        disabled={!online}
        onClick={() => {
          setOpen(true);
        }}
      >
        <Plus className="size-4" aria-hidden="true" /> Create issue
      </Button>
    );
  }
  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="space-y-1 p-2">
      <Input
        ref={inputRef}
        autoFocus
        aria-label="Summary for the new issue"
        placeholder="What needs to be done?"
        maxLength={255}
        value={summary}
        disabled={busy}
        aria-invalid={error ? true : undefined}
        onChange={(e) => {
          setSummary(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setOpen(false);
            setError(null);
          }
        }}
      />
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : (
        <p className="text-xs text-fg-muted">Press Enter to create, Esc to close.</p>
      )}
    </form>
  );
}
