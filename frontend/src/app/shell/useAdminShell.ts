import { useMatch } from 'react-router';

/** True on organization Administration routes (`/admin/*`). The dashboard tabs (`/settings`,
 * `/settings/members`, `/settings/audit`) open inside the organization dashboard instead. */
export function useAdminShell(): boolean {
  const org = useMatch('/o/:org/*');
  if (!org) return false;
  const rest = org.params['*'] ?? '';
  return rest === 'admin' || rest.startsWith('admin/');
}
