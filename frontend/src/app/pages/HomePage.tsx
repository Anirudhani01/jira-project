import { Navigate } from 'react-router';

import { useSession } from '../../features/auth/api';
import { lastOrg } from '../../features/orgs/api';

export function HomePage() {
  const session = useSession();
  if (session.data) {
    const orgs = session.data.orgs;
    const remembered = orgs.find((org) => org.slug === lastOrg());
    const target = remembered ?? orgs[0];
    return <Navigate to={target ? `/o/${target.slug}` : '/orgs/new'} replace />;
  }
  return (
    <section aria-labelledby="home-title" className="space-y-2">
      <h1 id="home-title" className="text-2xl font-semibold">
        Welcome
      </h1>
      <p className="text-slate-600">
        Sign in to see your organizations. Projects, issues and boards arrive in later milestones.
      </p>
    </section>
  );
}
