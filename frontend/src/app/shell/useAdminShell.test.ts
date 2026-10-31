import { describe, expect, it } from 'vitest';

import { adminBreadcrumbLabel } from '../../features/admin/adminNav';

describe('useAdminShell helpers', () => {
  it('maps canonical and legacy paths to breadcrumb labels', () => {
    expect(adminBreadcrumbLabel('/o/acme/admin', 'acme')).toBe('Overview');
    expect(adminBreadcrumbLabel('/o/acme/admin/general', 'acme')).toBe('General');
    expect(adminBreadcrumbLabel('/o/acme/settings', 'acme')).toBe('General');
    expect(adminBreadcrumbLabel('/o/acme/settings/members', 'acme')).toBe('Members');
    expect(adminBreadcrumbLabel('/o/acme/settings/audit', 'acme')).toBe('Audit Logs');
    expect(adminBreadcrumbLabel('/o/acme/admin/system/email', 'acme')).toBe('Email Delivery');
  });
});
