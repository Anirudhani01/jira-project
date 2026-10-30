import { MoreHorizontal } from 'lucide-react';
import { Link, useLocation } from 'react-router';

import { IconButton } from '../../components/ui/Button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../components/ui/Overlay';

import { issueDetailLinkProps } from './issueDetailNavigation';

export function IssueListRowActions({ org, issueKey }: { org: string; issueKey: string }) {
  const location = useLocation();
  const detailLink = issueDetailLinkProps(org, issueKey, location);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton label={`Actions for ${issueKey}`} size="sm" className="text-fg-muted">
          <MoreHorizontal className="size-4" aria-hidden="true" />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <Link {...detailLink}>Open issue</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
