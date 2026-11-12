import { AdminOrgManagePageFrame } from './AdminOrgManagePageFrame';

const CARD = 'admin-card space-y-2 rounded-xl border p-5 sm:p-6';
const HEADING = 'text-base font-medium text-[var(--admin-text)]';
const BODY = 'text-sm leading-relaxed text-[var(--admin-muted)]';

/** Organization admin view of in-app notification capabilities (informational only). */
export function AdminSystemNotificationsPage() {
  return (
    <AdminOrgManagePageFrame
      titleId="admin-system-notifications-title"
      title="Notifications"
      description="How notifications work in this product today"
    >
      <section className={CARD} aria-labelledby="admin-notifications-in-app">
        <h2 id="admin-notifications-in-app" className={HEADING}>
          In-app notifications are user-specific
        </h2>
        <p className={BODY}>
          Each person sees their own notifications, from the bell in the top bar. They are not shown
          in Administration.
        </p>
      </section>

      <section className={CARD} aria-labelledby="admin-notifications-policies">
        <h2 id="admin-notifications-policies" className={HEADING}>
          Organization-wide policies are not configurable
        </h2>
        <p className={BODY}>
          There are no organization settings for channels, quiet hours or digests. Every member gets
          the same behavior.
        </p>
        <ul className="list-disc space-y-1 pl-5 text-sm text-[var(--admin-muted)]">
          <li>Administrators cannot mute notifications for other users.</li>
          <li>Read and unread state belongs to each person.</li>
        </ul>
      </section>

      <section className={CARD} aria-labelledby="admin-notifications-guidance">
        <h2 id="admin-notifications-guidance" className={HEADING}>
          What you can do as an administrator
        </h2>
        <p className={BODY}>
          Manage membership under Members and Invitations. Security-relevant actions are recorded in
          Audit Logs. For invitation and account emails, see Email Delivery.
        </p>
      </section>
    </AdminOrgManagePageFrame>
  );
}
