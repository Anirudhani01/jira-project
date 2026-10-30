import { Card } from '../../../components/ui/Card';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-[var(--org-dash-bg)] px-3 py-2.5">
      <p className="text-xs font-medium text-[var(--org-dash-muted)]">{label}</p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums text-[var(--org-dash-text)]">{value}</p>
    </div>
  );
}

export function OrgOverviewCard({
  orgName,
  projectCount,
  memberCount,
  issueTotal,
  issueTotalPending,
}: {
  orgName: string;
  projectCount: number | null;
  memberCount: number | null;
  issueTotal: number | null;
  issueTotalPending: boolean;
}) {
  const projects = projectCount === null ? '—' : String(projectCount);
  const members = memberCount === null ? '—' : String(memberCount);
  const issues = issueTotalPending ? '…' : issueTotal === null ? '—' : String(issueTotal);

  return (
    <Card className="org-dash-card space-y-4 p-4">
      <div>
        <h2 className="text-sm font-semibold text-[var(--org-dash-text)]">Organization overview</h2>
        <p className="mt-1 text-xs text-[var(--org-dash-muted)]">{orgName}</p>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 xl:grid-cols-1">
        <Stat label="Projects" value={projects} />
        <Stat label="Total issues" value={issues} />
        <Stat label="Members" value={members} />
      </div>
    </Card>
  );
}
