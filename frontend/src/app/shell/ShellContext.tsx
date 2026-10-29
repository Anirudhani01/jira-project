import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

interface ShellContextValue {
  mobileNavOpen: boolean;
  setMobileNavOpen: (open: boolean) => void;
}

const ShellContext = createContext<ShellContextValue | null>(null);

export function ShellProvider({ children }: { children: ReactNode }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const value = useMemo(() => ({ mobileNavOpen, setMobileNavOpen }), [mobileNavOpen]);
  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

export function useShell(): ShellContextValue {
  const value = useContext(ShellContext);
  if (!value) throw new Error('useShell must be used inside ShellProvider');
  return value;
}
