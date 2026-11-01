/** Human-readable workflow status category (API stores snake_case). */
export function formatWorkflowStatusCategory(category: string): string {
  if (category === 'todo') return 'To do';
  if (category === 'in_progress') return 'In progress';
  if (category === 'done') return 'Done';
  return category;
}

export function unknownWorkflowStatusLabel(id: string): string {
  return `Unknown (${id.slice(0, 8)}…)`;
}

export function resolveWorkflowStatusName(
  id: string | null,
  statusNames: Map<string, string>,
  options?: { nullLabel?: string },
): string {
  if (id === null) {
    return options?.nullLabel ?? '—';
  }
  const known = statusNames.get(id);
  if (known !== undefined) return known;
  return unknownWorkflowStatusLabel(id);
}
