import { Link, useNavigate } from 'react-router';

import { Avatar } from '../../components/ui/Avatar';
import { Button } from '../../components/ui/Button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../components/ui/Overlay';
import { useLogout, useSession } from '../../features/auth/api';
import { THEME_OPTIONS, useTheme, type ThemePreference } from '../../theme/ThemeProvider';

export function ProfileMenu() {
  const session = useSession();
  const logout = useLogout();
  const navigate = useNavigate();
  const { preference, setPreference } = useTheme();
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
            <Link to="/account" className="text-fg">
              Account
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Theme</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={preference}
            onValueChange={(value) => {
              setPreference(value as ThemePreference);
            }}
          >
            {THEME_OPTIONS.map((option) => (
              <DropdownMenuRadioItem
                key={option.value}
                value={option.value}
                // Keep the menu open so the themes can be compared one after another.
                onSelect={(event) => {
                  event.preventDefault();
                }}
              >
                {option.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
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
