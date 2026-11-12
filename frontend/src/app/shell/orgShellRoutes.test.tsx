import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';

import { useAdminShell } from './useAdminShell';
import { useOrgDashboardHome } from './useOrgShell';

function at(path: string) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>
  );
  return {
    dashboard: renderHook(() => useOrgDashboardHome(), { wrapper }).result.current,
    admin: renderHook(() => useAdminShell(), { wrapper }).result.current,
  };
}

describe('which shell an organization URL belongs to', () => {
  it.each([
    '/o/acme',
    '/o/acme/',
    '/o/acme/settings',
    '/o/acme/settings/members',
    '/o/acme/settings/audit',
  ])('%s is the organization dashboard', (path) => {
    expect(at(path)).toEqual({ dashboard: true, admin: false });
  });

  it.each([
    '/o/acme/admin',
    '/o/acme/admin/members',
    '/o/acme/admin/audit',
    '/o/acme/admin/general',
  ])('%s is Administration', (path) => {
    expect(at(path)).toEqual({ dashboard: false, admin: true });
  });

  it.each(['/o/acme/p/WEB/board', '/o/acme/issues/WEB-1', '/o/acme/projects/new', '/login'])(
    '%s is neither',
    (path) => {
      expect(at(path)).toEqual({ dashboard: false, admin: false });
    },
  );
});
