import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { TooltipProvider } from '../components/ui/Overlay';
import { ToastProvider } from '../components/ui/Toast';
import { ThemeProvider } from '../theme/ThemeProvider';

export function AppProviders({ client, children }: { client: QueryClient; children: ReactNode }) {
  return (
    <ThemeProvider>
      <QueryClientProvider client={client}>
        <TooltipProvider>
          <ToastProvider>{children}</ToastProvider>
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
