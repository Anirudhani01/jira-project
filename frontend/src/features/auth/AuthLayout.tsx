import type { ReactNode } from 'react';

import { AuthMarketingPanel } from './AuthMarketingPanel';

/** Split layout for sign-in flows: 38% form / 62% marketing on lg+. */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-[calc(100dvh-3.5rem)] w-full flex-col lg:flex-row">
      <div className="flex w-full shrink-0 flex-col justify-center bg-surface px-6 py-10 sm:px-10 lg:w-[38%] lg:px-12 xl:px-16">
        {children}
      </div>
      <AuthMarketingPanel className="w-full border-t border-line lg:w-[62%] lg:border-t-0" />
    </div>
  );
}
