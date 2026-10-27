import { useNavigate, useParams } from 'react-router';

import { useSession } from '../auth/api';

const NEW_ORG = '__new__';

/** Lists the caller's organizations (from the session); the server decides access. */
export function OrgSwitcher() {
  const session = useSession();
  const navigate = useNavigate();
  const { org: current } = useParams();
  const orgs = session.data?.orgs ?? [];
  if (!session.data) return null;

  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="sr-only">Organization</span>
      <select
        className="rounded border border-slate-300 px-2 py-1"
        value={current?.toLowerCase() ?? ''}
        onChange={(event) => {
          const value = event.target.value;
          void navigate(value === NEW_ORG ? '/orgs/new' : `/o/${value}`);
        }}
      >
        <option value="" disabled>
          {orgs.length ? 'Choose organization' : 'No organizations'}
        </option>
        {orgs.map((org) => (
          <option key={org.slug} value={org.slug}>
            {org.name}
          </option>
        ))}
        <option value={NEW_ORG}>+ New organization</option>
      </select>
    </label>
  );
}
