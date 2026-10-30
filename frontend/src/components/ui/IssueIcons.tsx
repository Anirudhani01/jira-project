import {
  Bookmark,
  Bug,
  CheckSquare,
  ChevronDown,
  ChevronsDown,
  ChevronsUp,
  ChevronUp,
  Equal,
  GitBranch,
  Zap,
  type LucideIcon,
} from 'lucide-react';

import { cn } from '../../lib/cn';

import { statusLozengeClassName } from './statusStyles';

interface TypeEntry {
  icon: LucideIcon;
  color: string;
  label: string;
}
const TASK_TYPE: TypeEntry = { icon: CheckSquare, color: 'bg-[var(--task)]', label: 'Task' };
const TYPES: Record<string, TypeEntry> = {
  epic: { icon: Zap, color: 'bg-[var(--epic)]', label: 'Epic' },
  story: { icon: Bookmark, color: 'bg-[var(--story)]', label: 'Story' },
  task: TASK_TYPE,
  bug: { icon: Bug, color: 'bg-[var(--bug)]', label: 'Bug' },
  subtask: { icon: GitBranch, color: 'bg-[var(--subtask)]', label: 'Sub-task' },
};

/** Maps an issue type (`kind` and/or `name`) to its icon; unknown types fall back to Task. */
export function TypeIcon({
  kind,
  name,
  className,
}: {
  kind?: string;
  name?: string;
  className?: string;
}) {
  const lookup = (name ?? '').toLowerCase().replace(/[^a-z]/g, '');
  const key =
    lookup in TYPES ? lookup : kind === 'epic' ? 'epic' : kind === 'subtask' ? 'subtask' : 'task';
  const { icon: Icon, color, label } = TYPES[key] ?? TASK_TYPE;
  return (
    <span
      role="img"
      aria-label={name ?? label}
      title={name ?? label}
      className={cn(
        'inline-flex size-4 shrink-0 items-center justify-center rounded-[3px] text-white',
        color,
        className,
      )}
    >
      <Icon className="size-3" aria-hidden="true" />
    </span>
  );
}

interface PriorityEntry {
  icon: LucideIcon;
  color: string;
}
const MEDIUM_PRIORITY: PriorityEntry = { icon: Equal, color: 'text-[var(--p-medium)]' };
const PRIORITIES: Record<string, PriorityEntry> = {
  highest: { icon: ChevronsUp, color: 'text-[var(--p-highest)]' },
  high: { icon: ChevronUp, color: 'text-[var(--p-high)]' },
  medium: MEDIUM_PRIORITY,
  low: { icon: ChevronDown, color: 'text-[var(--p-low)]' },
  lowest: { icon: ChevronsDown, color: 'text-[var(--p-lowest)]' },
};

export function PriorityIcon({ name, className }: { name: string; className?: string }) {
  const { icon: Icon, color } = PRIORITIES[name.toLowerCase()] ?? MEDIUM_PRIORITY;
  return (
    <span
      role="img"
      aria-label={`${name} priority`}
      title={`${name} priority`}
      className={cn('inline-flex', color, className)}
    >
      <Icon className="size-4" aria-hidden="true" />
    </span>
  );
}

function statusCategoryLabel(category: string): string {
  const labels: Record<string, string> = {
    todo: 'to do',
    in_progress: 'in progress',
    done: 'done',
  };
  return labels[category] ?? category.replace(/_/g, ' ');
}

/** Status lozenge with a distinct colour per default status name (falls back to category). */
export function StatusLozenge({
  name,
  category,
  className,
}: {
  name: string;
  category: string;
  className?: string;
}) {
  const categoryLabel = statusCategoryLabel(category);
  return (
    <span
      className={statusLozengeClassName(name, category, className)}
      aria-label={`${name}, ${categoryLabel} category`}
    >
      {name}
    </span>
  );
}
