import { ApiError } from '../api/errors';
import { describeError } from '../forms';

import type { UxPermissionDeniedProps } from '../../components/ux/UxPermissionDenied';

/** Where the denial occurred — drives fixed copy and recovery, not backend detail. */
export type PermissionDeniedSurface =
  | 'org-audit'
  | 'org-settings'
  | 'create-project'
  | 'org-members-mutation'
  | 'project-settings'
  | 'issue-mutation'
  | 'generic-org'
  | 'generic-project';

const GENERIC_REASON = "You don't have permission to perform this action.";

const ORG_ADMIN_GUIDANCE = 'Ask an organization owner or admin to grant access if you need it.';

const PROJECT_ADMIN_GUIDANCE =
  'Ask a project admin or an organization owner or admin if you need access.';

const SURFACE_COPY: Record<
  PermissionDeniedSurface,
  { capability: string; reason: string; adminGuidance?: string }
> = {
  'org-audit': {
    capability: 'the organization audit log',
    reason: 'Only organization owners and admins can view the audit log.',
    adminGuidance: ORG_ADMIN_GUIDANCE,
  },
  'org-settings': {
    capability: 'organization settings',
    reason: "You don't have permission to change this organization.",
    adminGuidance: ORG_ADMIN_GUIDANCE,
  },
  'create-project': {
    capability: 'create projects in this organization',
    reason: "You don't have permission to create projects here.",
    adminGuidance:
      'Ask an organization owner or admin to grant project creation access if you need it.',
  },
  'org-members-mutation': {
    capability: 'manage organization members',
    reason: GENERIC_REASON,
    adminGuidance: ORG_ADMIN_GUIDANCE,
  },
  'project-settings': {
    capability: 'change project settings',
    reason: GENERIC_REASON,
    adminGuidance: PROJECT_ADMIN_GUIDANCE,
  },
  'issue-mutation': {
    capability: 'perform this action on the issue',
    reason: GENERIC_REASON,
    adminGuidance: PROJECT_ADMIN_GUIDANCE,
  },
  'generic-org': {
    capability: 'this organization area',
    reason: GENERIC_REASON,
    adminGuidance: ORG_ADMIN_GUIDANCE,
  },
  'generic-project': {
    capability: 'this project area',
    reason: GENERIC_REASON,
    adminGuidance: PROJECT_ADMIN_GUIDANCE,
  },
};

/** Allowlisted 403 codes that may select a fixed variant (never backend detail text). */
const ALLOWLISTED_FORBIDDEN_CODES = new Set(['forbidden']);

const CSRF_CODE = 'csrf_failed';
const INVITE_CODES = new Set(['invitation_email_mismatch', 'email_unverified']);

export function isInvitationForbidden(error: unknown): error is ApiError {
  return error instanceof ApiError && error.status === 403 && INVITE_CODES.has(error.code);
}

export function isRbacForbidden(error: unknown): error is ApiError {
  if (!(error instanceof ApiError) || error.status !== 403) return false;
  if (error.code === CSRF_CODE || INVITE_CODES.has(error.code)) return false;
  return true;
}

export interface PermissionDeniedCopy {
  capability: string;
  reason: string;
  adminGuidance?: string;
}

/** Fixed frontend copy for a surface; optional error only checks allowlisted code. */
export function permissionDeniedCopy(
  surface: PermissionDeniedSurface,
  error?: unknown,
): PermissionDeniedCopy {
  const base = SURFACE_COPY[surface];
  if (error instanceof ApiError && !ALLOWLISTED_FORBIDDEN_CODES.has(error.code)) {
    return {
      capability: base.capability,
      reason: GENERIC_REASON,
      ...(base.adminGuidance ? { adminGuidance: base.adminGuidance } : {}),
    };
  }
  return {
    capability: base.capability,
    reason: base.reason,
    ...(base.adminGuidance ? { adminGuidance: base.adminGuidance } : {}),
  };
}

export interface PermissionDeniedRecoveryContext {
  orgSlug?: string;
  projectKey?: string;
}

export interface PermissionDeniedRecovery {
  backLabel: string;
  backHref: string;
  membersHref?: string;
}

export function permissionDeniedRecovery(
  surface: PermissionDeniedSurface,
  ctx: PermissionDeniedRecoveryContext,
): PermissionDeniedRecovery {
  const orgHome = ctx.orgSlug ? `/o/${encodeURIComponent(ctx.orgSlug)}` : '/';
  const board =
    ctx.orgSlug && ctx.projectKey
      ? `/o/${encodeURIComponent(ctx.orgSlug)}/p/${encodeURIComponent(ctx.projectKey.toUpperCase())}/board`
      : orgHome;

  const isProject =
    surface === 'project-settings' || surface === 'generic-project' || surface === 'issue-mutation';

  if (isProject) {
    return {
      backLabel: 'Back to board',
      backHref: board,
    };
  }

  const membersHref = ctx.orgSlug
    ? `/o/${encodeURIComponent(ctx.orgSlug)}/settings/members`
    : undefined;

  return {
    backLabel: 'Back to organization home',
    backHref: orgHome,
    ...(membersHref ? { membersHref } : {}),
  };
}

/** Single inline sentence for mutation errors (no navigation). */
export function permissionDeniedInlineMessage(
  error: unknown,
  surface: PermissionDeniedSurface,
): string | null {
  if (!isRbacForbidden(error)) return null;
  const { reason, adminGuidance } = permissionDeniedCopy(surface, error);
  if (adminGuidance) return `${reason} ${adminGuidance}`;
  return reason;
}

/** RBAC 403 inline copy when applicable; otherwise existing describeError (CSRF, 401, network, etc.). */
export function mutationErrorMessage(error: unknown, surface: PermissionDeniedSurface): string {
  return permissionDeniedInlineMessage(error, surface) ?? describeError(error);
}

export function toUxPermissionDeniedProps(
  surface: PermissionDeniedSurface,
  ctx: PermissionDeniedRecoveryContext,
  error?: unknown,
): UxPermissionDeniedProps {
  const { capability, reason, adminGuidance } = permissionDeniedCopy(surface, error);
  const recovery = permissionDeniedRecovery(surface, ctx);
  const fullReason = adminGuidance ? `${reason} ${adminGuidance}` : reason;

  return {
    capability,
    reason: fullReason,
    backAction: { label: recovery.backLabel, href: recovery.backHref },
    ...(recovery.membersHref
      ? {
          contactAdmin: {
            label: 'View organization members',
            href: recovery.membersHref,
          },
        }
      : {}),
  };
}

/** Mapper-safe description for 403 RBAC (no recovery URLs). */
export function permissionDeniedMapperDescription(error: unknown): {
  title: string;
  description: string;
  recoveryHint?: string;
} {
  const { reason, adminGuidance } = permissionDeniedCopy('generic-org', error);
  return {
    title: 'Permission denied',
    description: reason,
    ...(adminGuidance ? { recoveryHint: adminGuidance } : {}),
  };
}
