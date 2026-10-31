import { ChevronDown } from 'lucide-react';
import { useState } from 'react';

import { Avatar } from '../../components/ui/Avatar';
import { PriorityIcon, StatusLozenge, TypeIcon } from '../../components/ui/IssueIcons';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../components/ui/Overlay';
import { cn } from '../../lib/cn';
import type { Issue, IssueType, Priority, ProjectMember } from '../../lib/api/types';

import { useApplyTransition, useTransitions, useUpdateIssue } from './api';

const memberTriggerClass = cn(
  'inline-flex max-w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm',
  'hover:bg-surface-hover outline-none ring-accent focus-visible:ring-2',
);

function MemberReadOnly({ name }: { name: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-fg">
      <Avatar name={name} size="xs" />
      <span className="truncate">{name}</span>
    </span>
  );
}

export function IssueListStatusMenu({
  org,
  issue,
  canTransition,
}: {
  org: string;
  issue: Issue;
  canTransition: boolean;
}) {
  const [open, setOpen] = useState(false);
  const transitions = useTransitions(org, issue.key, open && canTransition);
  const apply = useApplyTransition(org, issue.key);

  if (!canTransition) {
    return <StatusLozenge name={issue.status.name} category={issue.status.category} />;
  }

  const targets = transitions.data ?? [];

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Status: ${issue.status.name}. Choose a new status`}
          className="inline-flex max-w-full items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-1.5 outline-none ring-accent hover:bg-surface-hover focus-visible:ring-2"
        >
          <StatusLozenge name={issue.status.name} category={issue.status.category} />
          <ChevronDown className="size-3.5 text-fg-muted" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-64 overflow-y-auto">
        <DropdownMenuLabel>Change status</DropdownMenuLabel>
        <DropdownMenuItem disabled>{issue.status.name} (current)</DropdownMenuItem>
        {targets.length === 0 && !transitions.isPending ? (
          <DropdownMenuItem disabled>No other statuses available</DropdownMenuItem>
        ) : null}
        {targets.length > 0 ? <DropdownMenuSeparator /> : null}
        {targets.map((t) => (
          <DropdownMenuItem
            key={t.id}
            disabled={apply.isPending}
            onSelect={() => {
              apply.mutate({ transitionId: t.id, version: issue.version });
            }}
          >
            <StatusLozenge name={t.to_status.name} category={t.to_status.category} />
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function IssueListAssigneeMenu({
  org,
  issue,
  members,
  canAssign,
}: {
  org: string;
  issue: Issue;
  members: ProjectMember[];
  canAssign: boolean;
}) {
  const update = useUpdateIssue(org, issue.key);
  const label = issue.assignee?.display_name ?? 'Unassigned';

  if (!canAssign) {
    return issue.assignee ? (
      <MemberReadOnly name={issue.assignee.display_name} />
    ) : (
      <span className="text-sm text-fg-subtle">Unassigned</span>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Assignee: ${label}. Choose assignee`}
          className={memberTriggerClass}
        >
          {issue.assignee ? <Avatar name={issue.assignee.display_name} size="xs" /> : null}
          <span className="truncate text-fg-muted">{label}</span>
          <ChevronDown className="size-3.5 shrink-0 text-fg-muted" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-64 overflow-y-auto">
        <DropdownMenuLabel>Assign to</DropdownMenuLabel>
        <DropdownMenuItem
          disabled={update.isPending}
          onSelect={() => {
            update.mutate({ changes: { assignee_id: null }, version: issue.version });
          }}
        >
          Unassigned
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {members.map((member) => (
          <DropdownMenuItem
            key={member.user_id}
            disabled={update.isPending || issue.assignee?.id === member.user_id}
            onSelect={() => {
              update.mutate({
                changes: { assignee_id: member.user_id },
                version: issue.version,
              });
            }}
          >
            <span className="inline-flex items-center gap-2">
              <Avatar name={member.display_name} size="xs" />
              {member.display_name}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function IssueListReporterMenu({
  org,
  issue,
  members,
  canEdit,
}: {
  org: string;
  issue: Issue;
  members: ProjectMember[];
  canEdit: boolean;
}) {
  const update = useUpdateIssue(org, issue.key);
  const name = issue.reporter.display_name;

  if (!canEdit) {
    return <MemberReadOnly name={name} />;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Reporter: ${name}. Choose reporter`}
          className={memberTriggerClass}
        >
          <Avatar name={name} size="xs" />
          <span className="truncate text-fg">{name}</span>
          <ChevronDown className="size-3.5 shrink-0 text-fg-muted" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-64 overflow-y-auto">
        <DropdownMenuLabel>Change reporter</DropdownMenuLabel>
        {members.map((member) => (
          <DropdownMenuItem
            key={member.user_id}
            disabled={update.isPending || issue.reporter.id === member.user_id}
            onSelect={() => {
              update.mutate({
                changes: { reporter_id: member.user_id },
                version: issue.version,
              });
            }}
          >
            <span className="inline-flex items-center gap-2">
              <Avatar name={member.display_name} size="xs" />
              {member.display_name}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const fieldTriggerClass = cn(
  'inline-flex max-w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm text-fg',
  'hover:bg-surface-hover outline-none ring-accent focus-visible:ring-2',
);

export function IssueListTypeMenu({
  org,
  issue,
  types,
  canEdit,
}: {
  org: string;
  issue: Issue;
  types: IssueType[];
  canEdit: boolean;
}) {
  const update = useUpdateIssue(org, issue.key);

  if (!canEdit) {
    return (
      <span className="inline-flex items-center gap-2 text-sm text-fg">
        <TypeIcon kind={issue.type.kind} name={issue.type.name} />
        {issue.type.name}
      </span>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Type: ${issue.type.name}. Choose type`}
          className={fieldTriggerClass}
        >
          <TypeIcon kind={issue.type.kind} name={issue.type.name} />
          <span className="truncate">{issue.type.name}</span>
          <ChevronDown className="size-3.5 shrink-0 text-fg-muted" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-64 overflow-y-auto">
        <DropdownMenuLabel>Change type</DropdownMenuLabel>
        {types.map((t) => (
          <DropdownMenuItem
            key={t.id}
            disabled={update.isPending || issue.type.id === t.id}
            onSelect={() => {
              update.mutate({ changes: { type_id: t.id }, version: issue.version });
            }}
          >
            <span className="inline-flex items-center gap-2">
              <TypeIcon kind={t.kind} name={t.name} />
              {t.name}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function IssueListPriorityMenu({
  org,
  issue,
  priorities,
  canEdit,
  containedMenu = false,
}: {
  org: string;
  issue: Issue;
  priorities: Priority[];
  canEdit: boolean;
  /** When true, menu is nested inside a modal dialog (Radix focus trap). */
  containedMenu?: boolean;
}) {
  const update = useUpdateIssue(org, issue.key);

  if (!canEdit) {
    return (
      <span className="inline-flex items-center gap-2 text-sm text-fg">
        <PriorityIcon name={issue.priority.name} />
        {issue.priority.name}
      </span>
    );
  }

  return (
    <DropdownMenu modal={containedMenu ? false : true}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Priority: ${issue.priority.name}. Choose priority`}
          className={fieldTriggerClass}
        >
          <PriorityIcon name={issue.priority.name} />
          <span className="truncate">{issue.priority.name}</span>
          <ChevronDown className="size-3.5 shrink-0 text-fg-muted" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-64 overflow-y-auto">
        <DropdownMenuLabel>Change priority</DropdownMenuLabel>
        {priorities.map((p) => (
          <DropdownMenuItem
            key={p.id}
            textValue={p.name}
            disabled={update.isPending || issue.priority.id === p.id}
            onSelect={() => {
              update.mutate({ changes: { priority_id: p.id }, version: issue.version });
            }}
          >
            <span className="inline-flex items-center gap-2">
              <span aria-hidden="true">
                <PriorityIcon name={p.name} />
              </span>
              {p.name}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
