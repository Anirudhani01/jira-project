import { ChevronsUpDown } from 'lucide-react';
import { useNavigate, useParams } from 'react-router';

import { Button } from '../../components/ui/Button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../components/ui/Overlay';
import { useSession } from '../../features/auth/api';

/** Organization picker (replaces the legacy native `<select>`). */
export function OrgMenu() {
  const session = useSession();
  const navigate = useNavigate();
  const { org: currentSlug } = useParams();
  const orgs = session.data?.orgs ?? [];
  if (!session.data) return null;

  const current = orgs.find((o) => o.slug.toLowerCase() === currentSlug?.toLowerCase());
  const label = current?.name ?? (orgs.length ? 'Organization' : 'No organizations');

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="max-w-[12rem] justify-between gap-1 px-2">
          <span className="truncate">{label}</span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-60" aria-hidden="true" />
          <span className="sr-only">Switch organization</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto">
        <DropdownMenuLabel>Organizations</DropdownMenuLabel>
        {orgs.map((org) => (
          <DropdownMenuItem
            key={org.slug}
            onSelect={() => {
              void navigate(`/o/${org.slug}`);
            }}
          >
            {org.name}
            {current?.slug === org.slug ? ' ✓' : ''}
          </DropdownMenuItem>
        ))}
        {orgs.length === 0 ? (
          <DropdownMenuItem disabled>No organizations yet</DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => {
            void navigate('/orgs/new');
          }}
        >
          New organization…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
