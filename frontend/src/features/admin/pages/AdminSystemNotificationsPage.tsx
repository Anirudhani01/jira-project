import { Badge } from '../../../components/ui/Badge';

import { AdminOrgManagePageFrame } from './AdminOrgManagePageFrame';

/** Organization admin view of in-app notification capabilities (informational only). */
export function AdminSystemNotificationsPage() {
  return (
    <AdminOrgManagePageFrame
      titleId="admin-system-notifications-title"
      title="Notifications"
      description="How in-app notifications work in this product today. This page does not manage delivery or user inboxes."
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="neutral">Informational</Badge>
        <Badge tone="neutral">No org-wide policies</Badge>
      </div>

      <section
        className="admin-card space-y-3 rounded-xl border p-5 sm:p-6"
        aria-labelledby="admin-notifications-in-app"
      >
        <h2
          id="admin-notifications-in-app"
          className="text-lg font-semibold text-[var(--admin-text)]"
        >
          In-app notifications are user-specific
        </h2>
        <p className="text-sm leading-relaxed text-[var(--admin-muted)]">
          When someone is @mentioned, assigned, or otherwise notified, events are stored for that
          individual account within the organization context. Each person sees only their own
          notification history from the workspace header—not from this administration area.
        </p>
      </section>

      <section
        className="admin-card space-y-3 rounded-xl border p-5 sm:p-6"
        aria-labelledby="admin-notifications-policies"
      >
        <h2
          id="admin-notifications-policies"
          className="text-lg font-semibold text-[var(--admin-text)]"
        >
          Organization-wide policies are not configurable
        </h2>
        <p className="text-sm leading-relaxed text-[var(--admin-muted)]">
          There are no organization-level switches for notification channels, quiet hours, digest
          schedules, or default opt-in rules. Product behavior is uniform for all members; changes
          require a platform release rather than settings here.
        </p>
        <ul className="list-disc space-y-2 pl-5 text-sm text-[var(--admin-muted)]">
          <li>Administrators cannot mute notifications for other users.</li>
          <li>There are no per-team or per-project notification templates in Administration.</li>
          <li>End-user read and unread state stays in each person&apos;s own inbox.</li>
        </ul>
      </section>

      <section
        className="admin-card space-y-3 rounded-xl border p-5 sm:p-6"
        aria-labelledby="admin-notifications-guidance"
      >
        <h2
          id="admin-notifications-guidance"
          className="text-lg font-semibold text-[var(--admin-text)]"
        >
          What you can do as an administrator
        </h2>
        <p className="text-sm leading-relaxed text-[var(--admin-muted)]">
          Use People &amp; Access to manage membership and invitations. Audit logs (when enabled for
          your role) show security-relevant actions. For deliverability of email tied to invitations
          or account security, see Email Delivery under System.
        </p>
      </section>
    </AdminOrgManagePageFrame>
  );
}
