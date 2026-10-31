import { Avatar } from '../../components/ui/Avatar';
import { Combobox } from '../../components/ui/Combobox';
import { Dialog, DialogContent } from '../../components/ui/Overlay';
import { FormError } from '../../components/ui/Form';
import { mutationErrorMessage } from '../../lib/ux/permissionDenied';
import { useAssignIssues } from '../../features/issues/assignIssues';
import { useProjectMembers } from '../../features/projects/api';

import { projectOf } from './targetIssue';

/** "Assign to…" for the `A` shortcut: pick a project member (or Unassigned); it saves right away
 * and reports whether the server accepted it. */
export function AssignDialog({
  org,
  issueKey,
  onClose,
  onResult,
}: {
  org: string;
  issueKey: string;
  onClose: () => void;
  onResult: (message: { title: string; description?: string; error?: boolean }) => void;
}) {
  const members = useProjectMembers(org, projectOf(issueKey));
  const assign = useAssignIssues(org);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent title={`Assign ${issueKey}`} description="Choose who is responsible.">
        <FormError>
          {assign.error ? mutationErrorMessage(assign.error, 'issue-mutation') : null}
        </FormError>
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
          value={null}
          loading={members.isPending}
          onChange={(assigneeId) => {
            assign.mutate(
              { keys: [issueKey], assigneeId },
              {
                onSuccess: (result) => {
                  const failure = result.results.find((r) => !r.ok);
                  if (failure) {
                    onResult({
                      title: `Could not assign ${issueKey}`,
                      description: failure.message ?? failure.code ?? 'Try again.',
                      error: true,
                    });
                  } else {
                    onResult({
                      title: assigneeId ? `${issueKey} assigned` : `${issueKey} is now unassigned`,
                    });
                    onClose();
                  }
                },
              },
            );
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
