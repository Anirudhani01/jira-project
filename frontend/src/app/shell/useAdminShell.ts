import { useMatch } from 'react-router';

/** True on organization Administration routes (canonical `/admin/*` and legacy `/settings/*`). */
export function useAdminShell(): boolean {
  const org = useMatch('/o/:org/*');
  if (!org) return false;
  const rest = org.params['*'] ?? '';
  if (rest === 'admin' || rest.startsWith('admin/')) return true;
  if (rest === 'settings') return true;
  if (rest === 'settings/members' || rest === 'settings/audit') return true;
  return false;
}
