import { zodResolver } from '@hookform/resolvers/zod';
import { useState, type ReactNode } from 'react';
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
import { useOrgFormatters } from '../useOrgFormatters';
import { OrgRegionalPreferencesSection } from '../OrgRegionalPreferencesSection';
import { OrgStoryPointsSection } from '../OrgStoryPointsSection';
import { useOrg, useRenameOrg } from '../api';

const schema = z.object({
  name: z.string().trim().min(1, 'Enter a name.').max(100, 'Use at most 100 characters.'),
});

const MUTED = 'text-[var(--admin-muted)]';

function roleLabel(role: string): string {
  return role.charAt(0).toUpperCase() + role.slice(1);
}

/** One settings area: title and a line of help on the left, the controls or facts on the right. */
function Section({
  id,
  title,
  help,
  children,
}: {
  id: string;
  title: string;
  help?: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={id}
      className="grid gap-x-10 gap-y-4 px-5 py-6 sm:px-6 md:grid-cols-[13rem_minmax(0,1fr)]"
    >
      <div className="space-y-1">
        <h2 id={id} className="text-base font-medium text-[var(--admin-text)]">
          {title}
        </h2>
        {help ? <p className={`text-sm ${MUTED}`}>{help}</p> : null}
      </div>
      <div className="min-w-0 space-y-4">{children}</div>
    </section>
  );
}

/** A read-only fact: the label column is the same width in every section. */
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid min-h-9 grid-cols-[9rem_minmax(0,1fr)] items-center gap-x-3 text-sm">
      <dt className={MUTED}>{label}</dt>
      <dd className="min-w-0 text-[var(--admin-text)]">{children}</dd>
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
    <form onSubmit={(e) => void onSubmit(e)} noValidate className="space-y-3">
      <FormError>{failure}</FormError>
      <div className="flex items-end gap-3">
        <div className="min-w-0 max-w-sm flex-1">
          <TextField
            label="Name"
            error={form.formState.errors.name?.message}
            {...form.register('name')}
          />
        </div>
        <SubmitButton pending={rename.isPending}>Save</SubmitButton>
      </div>
      {rename.isSuccess ? (
        <p role="status" className="text-sm text-[var(--admin-text)]">
          Name saved.
        </p>
      ) : null}
    </form>
  );
}

function OrgProfile({ org, canManage }: { org: Org; canManage: boolean }) {
  return (
    <>
      {canManage ? (
        <OrgRenameForm org={org} />
      ) : (
        <dl>
          <Fact label="Name">{org.name}</Fact>
        </dl>
      )}
      {canManage ? null : (
        <p className={`text-sm ${MUTED}`}>
          Only organization owners and admins can change the display name.
        </p>
      )}
      <dl>
        <Fact label="Organization address">
          <code className="font-mono">{org.slug}</code>
        </Fact>
        <Fact label="Workspace URL">
          <code className="font-mono">/o/{org.slug}</code>
        </Fact>
      </dl>
      <p className={`text-sm ${MUTED}`}>The organization address cannot be changed.</p>
    </>
  );
}

function OrgIdCopy({ orgId }: { orgId: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <code className="break-all font-mono">{orgId}</code>
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
        <span role="status" className={`text-sm ${MUTED}`}>
          Copied to clipboard.
        </span>
      ) : null}
    </div>
  );
}

/** A pointer to another admin page: what lives there, and a button to go. */
function RelatedLink({
  title,
  description,
  to,
  label,
}: {
  title: string;
  description: string;
  to: string;
  label: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-[var(--admin-text)]">{title}</p>
        <p className={`text-sm ${MUTED}`}>{description}</p>
      </div>
      <Button variant="secondary" size="sm" asChild>
        <Link to={to}>{label}</Link>
      </Button>
    </div>
  );
}

function OrgSettingsContent({ org }: { org: Org }) {
  const orgFormat = useOrgFormatters();
  const canManage = org.permissions.includes('org.manage');
  const adminBase = `/o/${org.slug}/admin`;

  return (
    <div className="admin-card divide-y divide-[var(--admin-border)] rounded-xl border">
      <Section
        id="org-settings-profile"
        title="Organization profile"
        help="The name people see, and the address of this workspace"
      >
        <OrgProfile org={org} canManage={canManage} />
      </Section>

      <Section id="org-settings-details" title="Organization details">
        <dl>
          <Fact label="Created">
            <time dateTime={org.created_at}>{orgFormat.formatDateTime(org.created_at)}</time>
          </Fact>
          <Fact label="Organization ID">
            <OrgIdCopy orgId={org.id} />
          </Fact>
          <Fact label="Your role">
            <Badge tone="neutral">{roleLabel(org.role)}</Badge>
          </Fact>
        </dl>
      </Section>

      <Section
        id="org-settings-story-points"
        title="Story points"
        help="Defaults for every project"
      >
        <p className={`text-sm ${MUTED}`}>
          These apply to every project unless a project overrides them. Changing them can invalidate
          those overrides until project admins resolve the conflicts on each project&apos;s
          Estimates tab.
        </p>
        <OrgStoryPointsSection slug={org.slug} canManage={canManage} />
      </Section>

      <Section id="org-settings-regional" title="Regional preferences" help="Timezone and locale">
        <p className={`text-sm ${MUTED}`}>
          The default timezone and locale for dates and times across this organization.
        </p>
        <OrgRegionalPreferencesSection slug={org.slug} canManage={canManage} />
      </Section>

      <Section id="org-settings-related" title="Related settings" help="Managed on their own pages">
        <RelatedLink
          title="Workspace defaults"
          description="Issue types, priorities and other catalogs"
          to={`${adminBase}/catalogs`}
          label="Open Defaults & Catalogs"
        />
        <RelatedLink
          title="People & access"
          description="Members, invitations, roles and who can create projects"
          to={`${adminBase}/members`}
          label="Open Members"
        />
      </Section>

      <Section id="org-settings-lifecycle" title="Organization lifecycle">
        <p className={`text-sm ${MUTED}`}>
          To change organization ownership, promote another member to owner on the Members page.
          Only existing owners can assign or change the owner role.
        </p>
        <p className={`text-sm ${MUTED}`}>
          Organization deactivation and deletion are not available in this product version.
        </p>
      </Section>
    </div>
  );
}

export function OrgSettingsPage() {
  return (
    <AdminOrgManagePageFrame
      title="General"
      titleId="org-settings-title"
      description="Your organization's name, address and defaults"
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
