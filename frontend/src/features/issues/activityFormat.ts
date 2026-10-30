import type { IssueActivity } from '../../lib/api/types';

export function describeIssueActivity(activity: IssueActivity): string {
  switch (activity.action) {
    case 'created':
      return 'created this issue';
    case 'updated':
      if (activity.field === 'status') return 'changed status';
      return activity.field ? `updated ${activity.field}` : 'updated this issue';
    case 'transitioned':
      return 'changed status';
    case 'deleted':
      return 'deleted this issue';
    default:
      return activity.action.replaceAll('_', ' ');
  }
}
