import { AdminOrgManagePageFrame } from './AdminOrgManagePageFrame';

const CARD = 'admin-card space-y-2 rounded-xl border p-5 sm:p-6';
const HEADING = 'text-base font-medium text-[var(--admin-text)]';
const BODY = 'text-sm leading-relaxed text-[var(--admin-muted)]';

/** Organization admin view of platform email delivery (informational only). */
export function AdminSystemEmailPage() {
  return (
    <AdminOrgManagePageFrame
      titleId="admin-system-email-title"
      title="Email delivery"
      description="Email is sent by the platform, so there is nothing to configure here"
    >
      <section className={CARD} aria-labelledby="admin-email-outbox">
        <h2 id="admin-email-outbox" className={HEADING}>
          Transactional outbox
        </h2>
        <p className={BODY}>
          Invitations, address verification and password resets are queued and sent by the platform.
          Delivery problems are handled by the platform operator, not from Administration.
        </p>
      </section>

      <section className={CARD} aria-labelledby="admin-email-control">
        <h2 id="admin-email-control" className={HEADING}>
          What organization administrators control
        </h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-[var(--admin-muted)]">
          <li>Send invitations from Invitations; the platform sends the email for you.</li>
          <li>Sender name and message wording are set by the platform.</li>
          <li>Members finish verification and password resets from the links in those emails.</li>
        </ul>
      </section>

      <section className={CARD} aria-labelledby="admin-email-limits">
        <h2 id="admin-email-limits" className={HEADING}>
          What is not available here
        </h2>
        <p className={BODY}>
          SMTP settings, credentials, custom sender domains and bounce handling are not available in
          the product.
        </p>
      </section>
    </AdminOrgManagePageFrame>
  );
}
