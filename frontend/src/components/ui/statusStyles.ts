import { cn } from '../../lib/cn';

/** Shared lozenge chrome (matches Badge defaults). */
export const STATUS_LOZENGE_BASE =
  'inline-flex items-center gap-1 rounded-sm px-1.5 text-[11px] font-semibold uppercase tracking-wide leading-5 whitespace-nowrap';

/** Soft fill + high-contrast label (WCAG AA on 11px lozenges in light theme). */
const BY_NAME: Record<string, string> = {
  'to do': 'bg-[var(--status-todo-soft)] text-fg-muted',
  'in progress': 'bg-[var(--status-in-progress-soft)] text-fg',
  'in review': 'bg-[var(--status-in-review-soft)] text-fg',
  done: 'bg-[var(--status-done-soft)] text-fg',
};

const BY_CATEGORY: Record<string, string> = {
  todo: BY_NAME['to do'] ?? '',
  in_progress: BY_NAME['in progress'] ?? '',
  done: BY_NAME['done'] ?? '',
};

function normalizeStatusName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Background/text utilities for a workflow status lozenge. */
export function statusLozengeAppearance(name: string, category: string): string {
  const key = normalizeStatusName(name);
  return BY_NAME[key] ?? BY_CATEGORY[category] ?? BY_NAME['to do'] ?? '';
}

export function statusLozengeClassName(name: string, category: string, className?: string): string {
  return cn(STATUS_LOZENGE_BASE, statusLozengeAppearance(name, category), className);
}
