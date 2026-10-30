import type { UseQueryResult } from '@tanstack/react-query';

import { Avatar } from '../../components/ui/Avatar';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, Skeleton } from '../../components/ui/Card';
import { ErrorState } from '../../components/ui/States';
import type { ProjectMember } from '../../lib/api/types';

function roleTone(role: string): 'accent' | 'neutral' | 'info' {
  if (role === 'admin') return 'accent';
  if (role === 'member') return 'info';
  return 'neutral';
}

export function ProjectMembersSection({
  members,
  canManageMembers,
  onRemove,
  removing,
}: {
  members: Pick<UseQueryResult<ProjectMember[]>, 'isPending' | 'isError' | 'error' | 'data'>;
  canManageMembers: boolean;
  onRemove: (userId: string) => void;
  removing: boolean;
}) {
  if (members.isPending) {
    return (
      <Card className="space-y-4 p-5 sm:p-6">
        <Skeleton className="h-6 w-28" />
        <Skeleton className="h-12 w-full" />
      </Card>
    );
  }
  if (members.isError) return <ErrorState error={members.error} />;

  const items = members.data ?? [];

  return (
    <Card className="space-y-4 p-5 sm:p-6" aria-labelledby="project-members-title">
      <div>
        <h2 id="project-members-title" className="text-lg font-semibold text-fg">
          Members
        </h2>
        <p className="mt-1 text-sm text-fg-muted">People who can access this project.</p>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-fg-muted">No members yet.</p>
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {items.map((m) => (
            <li
              key={m.user_id}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5"
            >
              <div className="flex min-w-0 items-center gap-3">
                <Avatar name={m.display_name} size="sm" />
                <div className="min-w-0">
                  <p className="truncate font-medium text-fg">{m.display_name}</p>
                  <p className="truncate text-xs text-fg-muted">{m.email}</p>
                </div>
                <Badge tone={roleTone(m.role)}>{m.role}</Badge>
              </div>
              {canManageMembers ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-danger hover:bg-danger/10 hover:text-danger"
                  disabled={removing}
                  aria-label={`Remove ${m.display_name} from project`}
                  onClick={() => {
                    onRemove(m.user_id);
                  }}
                >
                  Remove
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
