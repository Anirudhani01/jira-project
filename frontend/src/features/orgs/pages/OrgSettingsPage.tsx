import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useParams } from 'react-router';
import { z } from 'zod';

import { AdminOrgManagePageFrame } from '../../admin/pages/AdminOrgManagePageFrame';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { FormError, SubmitButton, TextField } from '../../../components/ui/Form';
import { ApiError } from '../../../lib/api/errors';
import type { Org } from '../../../lib/api/types';
import { applyServerErrors, describeError } from '../../../lib/forms';
import { useOrg, useRenameOrg } from '../api';

const schema = z.object({
  name: z.string().trim().min(1, 'Enter a name.').max(100, 'Use at most 100 characters.'),
});

const createdFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

function roleLabel(role: string): string {
  return role.charAt(0).toUpperCase() + role.slice(1);
}

function OrgProfileSection({ org, canManage }: { org: Org; canManage: boolean }) {
  if (canManage) {
    return <OrgRenameForm org={org} />;
  }
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-[var(--admin-text)]">Name</p>
      <p className="text-base text-[var(--admin-text)]">{org.name}</p>
      <p className="text-sm text-[var(--admin-muted)]">
        Only organization owners and admins can change the display name.
      </p>
    </div>
  );
}

function OrgRenameForm({ org }: { org: Org }) {
  const rename = useRenameOrg(org.slug);
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { name: org.name },
  });
  const onSubmit = form.handleSubmit(async ({ name }) => {
    try {
      await rename.mutateAsync(name);
    } catch (error) {
      applyServerErrors(error, ['name'], form.setError);
    }
  });
  const failure =
    rename.error && !(rename.error instanceof ApiError && rename.error.status === 422)
      ? describeError(rename.error)
      : null;
  return (
    <form onSubmit={(e) => void onSubmit(e)} noValidate className="max-w-md space-y-3">
      <FormError>{failure}</FormError>
      {rename.isSuccess ? (
        <p role="status" className="text-sm text-[var(--admin-text)]">
          Name saved.
        </p>
      ) : null}
      <TextField
        label="Name"
        error={form.formState.errors.name?.message}
        {...form.register('name')}
      />
      <SubmitButton pending={rename.isPending}>Save</SubmitButton>
    </form>
  );
}

function OrgSlugDetails({ org }: { org: Org }) {
  return (
    <dl className="space-y-3 text-sm">
      <div>
        <dt className="font-medium text-[var(--admin-muted)]">Organization address (slug)</dt>
        <dd className="mt-1 font-mono text-[var(--admin-text)]">{org.slug}</dd>
      </div>
      <div>
        <dt className="font-medium text-[var(--admin-muted)]">Workspace URL</dt>
        <dd className="mt-1 font-mono text-[var(--admin-text)]">/o/{org.slug}</dd>
      </div>
      <p className="text-[var(--admin-muted)]">The organization address cannot be changed.</p>
    </dl>
  );
}

function OrgIdCopy({ orgId }: { orgId: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <code className="break-all rounded-md bg-[var(--admin-surface)] px-2 py-1 font-mono text-sm text-[var(--admin-text)]">
        {orgId}
      </code>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => {
          void navigator.clipboard.writeText(orgId).then(() => {
            setCopied(true);
            window.setTimeout(() => {
              setCopied(false);
            }, 2000);
          });
        }}
      >
        Copy organization ID
      </Button>
      {copied ? (
        <span role="status" className="text-sm text-[var(--admin-muted)]">
          Copied to clipboard.
        </span>
      ) : null}
    </div>
  );
}

function OrgSettingsContent({ org }: { org: Org }) {
  const canManage = org.permissions.includes('org.manage');
  const adminBase = `/o/${org.slug}/admin`;

  return (
    <div className="space-y-6">
      <section
        className="admin-card space-y-4 rounded-xl border p-5 sm:p-6"
        aria-labelledby="org-settings-profile"
      >
        <h2 id="org-settings-profile" className="text-lg font-semibold text-[var(--admin-text)]">
          Organization profile
        </h2>
        <OrgProfileSection org={org} canManage={canManage} />
        <OrgSlugDetails org={org} />
      </section>

      <section
        className="admin-card space-y-4 rounded-xl border p-5 sm:p-6"
        aria-labelledby="org-settings-details"
      >
        <h2 id="org-settings-details" className="text-lg font-semibold text-[var(--admin-text)]">
          Organization details
        </h2>
        <dl className="space-y-4 text-sm">
          <div>
            <dt className="font-medium text-[var(--admin-muted)]">Created</dt>
            <dd className="mt-1 text-[var(--admin-text)]">
              <time dateTime={org.created_at}>
                {createdFormat.format(new Date(org.created_at))}
              </time>
            </dd>
          </div>
          <div>
            <dt className="font-medium text-[var(--admin-muted)]">Organization ID</dt>
            <dd className="mt-2">
              <OrgIdCopy orgId={org.id} />
            </dd>
          </div>
          <div>
            <dt className="font-medium text-[var(--admin-muted)]">Your role</dt>
            <dd className="mt-2">
              <Badge tone="neutral">{roleLabel(org.role)}</Badge>
            </dd>
          </div>
        </dl>
      </section>

      <section
        className="admin-card space-y-3 rounded-xl border p-5 sm:p-6"
        aria-labelledby="org-settings-defaults"
      >
        <h2 id="org-settings-defaults" className="text-lg font-semibold text-[var(--admin-text)]">
          Workspace defaults
        </h2>
        <p className="text-sm leading-relaxed text-[var(--admin-muted)]">
          Issue types, priorities, and other seeded catalogs are managed under Defaults &amp;
          Catalogs.
        </p>
        <Button variant="secondary" size="sm" asChild>
          <Link to={`${adminBase}/catalogs`}>Open Defaults &amp; Catalogs</Link>
        </Button>
      </section>

      <section
        className="admin-card space-y-3 rounded-xl border p-5 sm:p-6"
        aria-labelledby="org-settings-people"
      >
        <h2 id="org-settings-people" className="text-lg font-semibold text-[var(--admin-text)]">
          People &amp; access
        </h2>
        <p className="text-sm leading-relaxed text-[var(--admin-muted)]">
          Membership, invitations, roles, and the explicit project-creation grant are managed on the
          Members page.
        </p>
        <Button variant="secondary" size="sm" asChild>
          <Link to={`${adminBase}/members`}>Open Members</Link>
        </Button>
      </section>

      <section
        className="admin-card space-y-3 rounded-xl border p-5 sm:p-6"
        aria-labelledby="org-settings-regional"
      >
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="org-settings-regional" className="text-lg font-semibold text-[var(--admin-text)]">
            Regional preferences
          </h2>
          <Badge tone="neutral">Not configurable</Badge>
        </div>
        <p className="text-sm leading-relaxed text-[var(--admin-muted)]">
          Organization-level timezone, locale, and date or time format settings are not supported
          yet. Dates and times in the product use server and browser defaults.
        </p>
      </section>

      <section
        className="admin-card space-y-3 rounded-xl border p-5 sm:p-6"
        aria-labelledby="org-settings-lifecycle"
      >
        <h2 id="org-settings-lifecycle" className="text-lg font-semibold text-[var(--admin-text)]">
          Organization lifecycle
        </h2>
        <p className="text-sm leading-relaxed text-[var(--admin-muted)]">
          To change organization ownership, promote another member to owner on the Members page.
          Only existing owners can assign or change the owner role.
        </p>
        <p className="text-sm leading-relaxed text-[var(--admin-muted)]">
          Organization deactivation and deletion are not available in this product version.
        </p>
      </section>
    </div>
  );
}

export function OrgSettingsPage() {
  return (
    <AdminOrgManagePageFrame
      title="General"
      titleId="org-settings-title"
      description="Organization profile and workspace identity."
      requireManage={false}
    >
      <OrgSettingsLoaded />
    </AdminOrgManagePageFrame>
  );
}

/** Org is already loaded by AdminOrgManagePageFrame; cache serves this hook immediately. */
function OrgSettingsLoaded() {
  const { org: slug = '' } = useParams();
  const org = useOrg(slug);
  if (!org.data) return null;
  return <OrgSettingsContent org={org.data} />;
}
