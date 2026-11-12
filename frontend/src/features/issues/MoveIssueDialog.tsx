import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router';

import { Button } from '../../components/ui/Button';
import { Combobox } from '../../components/ui/Combobox';
import { FormError } from '../../components/ui/Form';
import { Dialog, DialogClose, DialogContent } from '../../components/ui/Overlay';
import { describeError } from '../../lib/forms';
import type { Issue } from '../../lib/api/types';
import { useProjects } from '../projects/api';

import { useRelocateIssue } from './api';

/** Move one issue to another project. The status is matched automatically; sprint, fix
 * version and parent are cleared, labels carry over by name, and the old key keeps working. */
export function MoveIssueDialog({
  org,
  issue,
  open,
  onOpenChange,
}: {
  org: string;
  issue: Issue;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const locationState: unknown = location.state;
  const projects = useProjects(org);
  const relocate = useRelocateIssue(org, issue.key);
  const [target, setTarget] = useState<string | null>(null);
  const options = (projects.data ?? [])
    .filter((project) => project.key !== issue.project_key && !project.archived)
    .map((project) => ({
      value: project.key,
      label: project.key,
      description: project.name,
    }));

  const move = () => {
    if (!target) return;
    relocate.mutate(
      { targetProjectKey: target, version: issue.version },
      {
        onSuccess: (moved) => {
          onOpenChange(false);
          void navigate(`/o/${org}/issues/${moved.key}`, { replace: true, state: locationState });
        },
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setTarget(null);
          relocate.reset();
        }
        onOpenChange(next);
      }}
    >
      <DialogContent
        title={`Move ${issue.key} to another project`}
        description="The issue gets a new key in the other project and the old key keeps working."
      >
        <div className="space-y-4">
          <FormError>{relocate.error ? describeError(relocate.error) : null}</FormError>
          <Combobox
            label="Target project"
            options={options}
            value={target}
            onChange={setTarget}
            placeholder="Choose a project"
            emptyText="No other project you can add issues to."
          />
          <ul className="list-disc space-y-1 pl-5 text-sm text-fg-muted">
            <li>The status is matched by name, then by category.</li>
            <li>Sprint, fix version and parent are cleared; labels carry over by name.</li>
            <li>Issues with sub-tasks or other children cannot be moved yet.</li>
          </ul>
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="ghost" size="sm">
                Cancel
              </Button>
            </DialogClose>
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={!target || relocate.isPending}
              onClick={move}
            >
              {relocate.isPending ? 'Moving…' : 'Move issue'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
