import { Outlet, useParams } from 'react-router';

import { OrgFormatProvider } from './OrgFormatProvider';

/** Wraps organization workspace routes with shared org settings + formatting context. */
export function OrgWorkspaceLayout() {
  const { org: orgSlug = '' } = useParams();
  return (
    <OrgFormatProvider orgSlug={orgSlug}>
      <Outlet />
    </OrgFormatProvider>
  );
}
