import { Monitor, Moon, Sun } from 'lucide-react';

import { IconButton } from '../../components/ui/Button';
import { useTheme, type ThemePreference } from '../../theme/ThemeProvider';

const ORDER: ThemePreference[] = ['light', 'dark', 'system'];

function nextPreference(current: ThemePreference): ThemePreference {
  const index = ORDER.indexOf(current);
  return ORDER[(index + 1) % ORDER.length] ?? 'system';
}

function label(preference: ThemePreference, resolved: 'light' | 'dark'): string {
  if (preference === 'system') return `Theme: system (${resolved})`;
  return `Theme: ${preference}`;
}

function Icon({ preference }: { preference: ThemePreference }) {
  if (preference === 'dark') return <Moon className="size-4" aria-hidden="true" />;
  if (preference === 'system') return <Monitor className="size-4" aria-hidden="true" />;
  return <Sun className="size-4" aria-hidden="true" />;
}

export function ThemeToggle() {
  const { preference, resolved, setPreference } = useTheme();
  return (
    <IconButton
      label={label(preference, resolved)}
      size="sm"
      onClick={() => {
        setPreference(nextPreference(preference));
      }}
    >
      <Icon preference={preference} />
    </IconButton>
  );
}
