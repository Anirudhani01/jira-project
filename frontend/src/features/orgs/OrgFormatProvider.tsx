import { createContext, useMemo, type ReactNode } from 'react';

import {
  createFallbackOrgFormatters,
  createOrgFormatters,
  type OrgFormatters,
} from '../../lib/orgFormatting';

import { useOrgSettings } from './api';

const OrgFormatContext = createContext<OrgFormatters>(createFallbackOrgFormatters());

export function OrgFormatProvider({ orgSlug, children }: { orgSlug: string; children: ReactNode }) {
  const settings = useOrgSettings(orgSlug);

  const formatters = useMemo(() => {
    if (settings.isSuccess) {
      return createOrgFormatters({
        timezone: settings.data.timezone,
        locale: settings.data.locale,
        isFallback: false,
      });
    }
    return createFallbackOrgFormatters();
  }, [settings.data, settings.isSuccess]);

  return <OrgFormatContext.Provider value={formatters}>{children}</OrgFormatContext.Provider>;
}

export function OrgFormatContextProvider({
  value,
  children,
}: {
  value: OrgFormatters;
  children: ReactNode;
}) {
  return <OrgFormatContext.Provider value={value}>{children}</OrgFormatContext.Provider>;
}

export { OrgFormatContext };
