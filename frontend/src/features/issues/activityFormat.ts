import type { IssueActivity } from '../../lib/api/types';

/** Name of a `{ id, name }` reference stored in an activity value; `null` when there is none. */
function refName(value: unknown): string | null {
  if (typeof value === 'string') return value.length > 0 ? value : null;
  if (typeof value !== 'object' || value === null) return null;
  const name = (value as { name?: unknown }).name;
  return typeof name === 'string' && name.length > 0 ? name : null;
}

export interface StatusRef {
  id: string | null;
  name: string;
}

function statusRef(value: unknown): StatusRef | null {
  const name = refName(value);
  if (!name) return null;
  const id = (value as { id?: unknown }).id;
  return { id: typeof id === 'string' ? id : null, name };
}

/** The statuses of a status-change entry; `null` for other entries or when no name was kept. */
export function statusChangeOf(
  activity: IssueActivity,
): { from: StatusRef | null; to: StatusRef } | null {
  const isStatusChange =
    activity.action === 'transitioned' ||
    (activity.action === 'updated' && activity.field === 'status');
  if (!isStatusChange) return null;
  const to = statusRef(activity.new_value);
  return to ? { from: statusRef(activity.old_value), to } : null;
}

/** Sprint names of a sprint-change entry; `null` when neither name was kept. */
export function sprintChangeOf(
  activity: IssueActivity,
): { from: string | null; to: string | null } | null {
  if (activity.action !== 'sprint_changed') return null;
  const from = refName(activity.old_value);
  const to = refName(activity.new_value);
  return from || to ? { from, to } : null;
}

/** The issue type recorded when an issue was created; `null` when none was kept. */
export function createdTypeOf(activity: IssueActivity): string | null {
  if (activity.action !== 'created') return null;
  const value = activity.new_value;
  if (typeof value !== 'object' || value === null) return null;
  return refName((value as { type?: unknown }).type);
}

function describeStatusChange(activity: IssueActivity): string {
  const from = refName(activity.old_value);
  const to = refName(activity.new_value);
  if (from && to) return `changed status from ${from} to ${to}`;
  if (to) return `changed status to ${to}`;
  return 'changed status'; // entries recorded before the names were kept
}

function describeSprintChange(activity: IssueActivity): string {
  const from = refName(activity.old_value);
  const to = refName(activity.new_value);
  if (from && to) return `moved from ${from} to ${to}`;
  if (to) return `added to ${to}`;
  if (from) return `removed from ${from}`;
  return 'sprint changed';
}

export function describeIssueActivity(activity: IssueActivity): string {
  switch (activity.action) {
    case 'created':
      return 'created this issue';
    case 'updated':
      if (activity.field === 'status') return describeStatusChange(activity);
      return activity.field ? `updated ${activity.field}` : 'updated this issue';
    case 'transitioned':
      return describeStatusChange(activity);
    case 'sprint_changed':
      return describeSprintChange(activity);
    case 'deleted':
      return 'deleted this issue';
    default:
      return activity.action.replaceAll('_', ' ');
  }
}
