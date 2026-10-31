import { Combobox } from '../../components/ui/Combobox';
import { useToast } from '../../components/ui/Toast';
import { ApiError } from '../../lib/api/errors';
import type { Issue } from '../../lib/api/types';
import { mutationErrorMessage } from '../../lib/ux/permissionDenied';
import { useVersions } from '../backlog/planApi';

import { useUpdateIssue } from './api';

/** Fix version in the details panel: a searchable picker of the project's non-archived versions
 * (and "None"). Saves with `If-Match`; a stale version is reported, never overwritten. */
export function FixVersionField({
  org,
  issue,
  canEdit,
}: {
  org: string;
  issue: Issue;
  canEdit: boolean;
}) {
  const versions = useVersions(org, issue.project_key, false);
  const update = useUpdateIssue(org, issue.key);
  const toast = useToast();
  const current = issue.fix_version;
  const options = (versions.data ?? []).map((v) => ({
    value: v.id,
    label: v.name,
    description: v.status === 'released' ? 'Released' : undefined,
  }));
  if (current && !options.some((o) => o.value === current.id)) {
    options.unshift({ value: current.id, label: current.name, description: current.status });
  }

  if (!canEdit) return <span>{current?.name ?? 'No version'}</span>;
  return (
    <div className="[&>div>span]:sr-only">
      <Combobox
        label="Fix version"
        clearLabel="No version"
        searchPlaceholder="Search versions…"
        emptyText="No versions yet"
        options={options.map(({ description, ...rest }) => ({
          ...rest,
          ...(description ? { description } : {}),
        }))}
        value={current?.id ?? null}
        loading={versions.isPending}
        error={
          update.error && !(update.error instanceof ApiError && update.error.status === 412)
            ? mutationErrorMessage(update.error, 'issue-mutation')
            : null
        }
        onChange={(next) => {
          if (next === (current?.id ?? null)) return;
          update.mutate(
            { changes: { fix_version_id: next }, version: issue.version },
            {
              onError: (failure) => {
                if (failure instanceof ApiError && failure.status === 412) {
                  toast({
                    title: 'Updated by someone else',
                    description: 'The fix version was not changed. Reload to see the latest.',
                    variant: 'error',
                  });
                }
              },
            },
          );
        }}
      />
    </div>
  );
}
