import { useContext } from 'react';

import type { OrgFormatters } from '../../lib/orgFormatting';

import { OrgFormatContext } from './OrgFormatProvider';

/** Org-scoped formatters; falls back to UTC / en-US outside a provider. */
export function useOrgFormatters(): OrgFormatters {
  return useContext(OrgFormatContext);
}
