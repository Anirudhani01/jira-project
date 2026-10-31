import { PageHeader } from '../../components/ui/PageHeader';

/** Polished stub for A1b sections; keeps routing and shell valid in A1a. */
export function AdminPlaceholderPage({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="admin-page space-y-6">
      <PageHeader title={title} titleId="admin-placeholder-title" description={description} />
      <div className="admin-card max-w-2xl rounded-xl border p-6">
        <p className="text-sm leading-relaxed text-[var(--admin-muted)]">
          This section is part of the Enterprise Administration rollout. Content and controls will
          appear here in the next delivery slice. Navigation and permissions are wired; no
          configuration changes are available on this page yet.
        </p>
      </div>
    </div>
  );
}
