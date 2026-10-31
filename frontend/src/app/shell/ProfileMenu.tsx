import { Link, useNavigate } from 'react-router';

import { Avatar } from '../../components/ui/Avatar';
import { Button } from '../../components/ui/Button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../components/ui/Overlay';
import { useLogout, useSession } from '../../features/auth/api';

export function ProfileMenu() {
  const session = useSession();
  const logout = useLogout();
  const navigate = useNavigate();
  if (!session.data) return null;

  const { display_name } = session.data.user;

  return (
    <div className="flex min-w-0 shrink items-center gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="max-w-full shrink gap-2 px-2">
            <Avatar name={display_name} size="sm" />
            <span className="hidden max-w-[8rem] truncate sm:inline">{display_name}</span>
            <span className="sr-only">Open account menu for {display_name}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>{display_name}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link to="/account">Account</Link>
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={logout.isPending}
            onSelect={() => {
              logout.mutate(undefined, { onSuccess: () => void navigate('/login') });
            }}
          >
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {logout.isError ? (
        <span role="alert" className="max-w-[8rem] text-xs text-danger">
          Sign-out failed. Try again.
        </span>
      ) : null}
    </div>
  );
}
