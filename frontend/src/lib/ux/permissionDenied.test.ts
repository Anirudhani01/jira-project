import { describe, expect, it } from 'vitest';

import { ApiError } from '../api/errors';

import {
  isRbacForbidden,
  permissionDeniedCopy,
  permissionDeniedInlineMessage,
  permissionDeniedRecovery,
  toUxPermissionDeniedProps,
} from './permissionDenied';

describe('permissionDenied', () => {
  it('treats csrf and invite codes as not RBAC forbidden', () => {
    expect(isRbacForbidden(new ApiError({ status: 403, code: 'csrf_failed', title: 'CSRF' }))).toBe(
      false,
    );
    expect(
      isRbacForbidden(
        new ApiError({ status: 403, code: 'invitation_email_mismatch', title: 'Mismatch' }),
      ),
    ).toBe(false);
  });

  it('treats forbidden as RBAC', () => {
    expect(
      isRbacForbidden(new ApiError({ status: 403, code: 'forbidden', title: 'Forbidden' })),
    ).toBe(true);
  });

  it('never echoes backend detail into copy', () => {
    const error = new ApiError({
      status: 403,
      code: 'forbidden',
      title: 'Forbidden',
      detail: 'SECRET-PROJECT-WEB tenant uuid leak',
    });
    const copy = permissionDeniedCopy('org-audit', error);
    expect(copy.reason).not.toContain('SECRET');
    expect(copy.reason).toContain('owners and admins');
  });

  it('uses generic reason for unknown forbidden codes', () => {
    const copy = permissionDeniedCopy(
      'org-settings',
      new ApiError({
        status: 403,
        code: 'custom_internal',
        title: 'No',
        detail: 'internal only',
      }),
    );
    expect(copy.reason).toBe("You don't have permission to perform this action.");
  });

  it('builds org recovery with members link label', () => {
    const props = toUxPermissionDeniedProps('org-audit', { orgSlug: 'acme' });
    expect(props.backAction).toEqual({
      label: 'Back to organization home',
      href: '/o/acme',
    });
    expect(props.contactAdmin).toEqual({
      label: 'View organization members',
      href: '/o/acme/settings/members',
    });
  });

  it('builds project recovery to board without members link', () => {
    const recovery = permissionDeniedRecovery('project-settings', {
      orgSlug: 'acme',
      projectKey: 'web',
    });
    expect(recovery.backHref).toBe('/o/acme/p/WEB/board');
    expect(recovery.membersHref).toBeUndefined();
  });

  it('inline message combines reason and guidance for mutations', () => {
    const msg = permissionDeniedInlineMessage(
      new ApiError({ status: 403, code: 'forbidden', title: 'Forbidden' }),
      'issue-mutation',
    );
    expect(msg).toContain('permission');
    expect(msg).toContain('project admin');
  });
});
