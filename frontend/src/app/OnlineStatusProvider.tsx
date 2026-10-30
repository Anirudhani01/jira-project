import { createContext, useContext, type ReactNode } from 'react';

import { useOnlineStatus } from '../hooks/useOnlineStatus';

const OnlineStatusContext = createContext(true);

export function OnlineStatusProvider({ children }: { children: ReactNode }) {
  const online = useOnlineStatus();
  return <OnlineStatusContext.Provider value={online}>{children}</OnlineStatusContext.Provider>;
}

export function useAppOnline(): boolean {
  return useContext(OnlineStatusContext);
}
