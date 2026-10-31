import { Badge } from '../../../components/ui/Badge';

import { AdminOrgManagePageFrame } from './AdminOrgManagePageFrame';

/** Organization admin view of platform email delivery (informational only). */
export function AdminSystemEmailPage() {
  return (
    <AdminOrgManagePageFrame
      titleId="admin-system-email-title"
      title="Email delivery"
      description="Transactional email is sent by the platform. Organization administrators cannot view or edit delivery infrastructure."
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="neutral">Platform-managed</Badge>
        <Badge tone="neutral">Transactional only</Badge>
      </div>

      <section
        className="admin-card space-y-3 rounded-xl border p-5 sm:p-6"
        aria-labelledby="admin-email-outbox"
      >
        <h2 id="admin-email-outbox" className="text-lg font-semibold text-[var(--admin-text)]">
          Transactional outbox
        </h2>
        <p className="text-sm leading-relaxed text-[var(--admin-muted)]">
          Outbound messages—such as address verification, password reset, and organization
          invitations—are queued in a transactional outbox and delivered by background workers
          operated by the platform. Delivery runs outside this application UI; failures are handled
          operationally, not through Administration settings.
        </p>
      </section>

      <section
        className="admin-card space-y-3 rounded-xl border p-5 sm:p-6"
        aria-labelledby="admin-email-control"
      >
        <h2 id="admin-email-control" className="text-lg font-semibold text-[var(--admin-text)]">
          What organization administrators control
        </h2>
        <ul className="list-disc space-y-2 pl-5 text-sm text-[var(--admin-muted)]">
          <li>
            Send invitations from People &amp; Access; the platform sends the invitation email on
            your behalf.
          </li>
          <li>Rely on default product copy and sender identity chosen by the platform operator.</li>
          <li>
            Direct members to complete verification or reset flows from links in those emails.
          </li>
        </ul>
      </section>

      <section
        className="admin-card space-y-3 rounded-xl border p-5 sm:p-6"
        aria-labelledby="admin-email-limits"
      >
        <h2 id="admin-email-limits" className="text-lg font-semibold text-[var(--admin-text)]">
          What is not available here
        </h2>
        <p className="text-sm leading-relaxed text-[var(--admin-muted)]">
          SMTP hosts, API keys, credentials, environment configuration, and connection details are
          never shown in the product. You cannot configure custom domains, relay servers, bounce
          handling, or marketing campaigns from Administration.
        </p>
      </section>
    </AdminOrgManagePageFrame>
  );
}
