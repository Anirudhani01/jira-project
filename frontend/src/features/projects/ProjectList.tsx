import { Link } from 'react-router';

import { ErrorState, LoadingState } from '../../components/ui/States';

import { useProjects } from './api';

export function ProjectList({ org, canCreate }: { org: string; canCreate: boolean }) {
  const projects = useProjects(org);
  if (projects.isPending) return <LoadingState label="Loading projects" />;
  if (projects.isError) return <ErrorState error={projects.error} />;
  return (
    <div className="space-y-3">
      {projects.data.length ? (
        <ul className="space-y-1">
          {projects.data.map((p) => (
            <li key={p.key}>
              <Link to={`/o/${org}/p/${p.key}`} className="text-blue-700 underline">
                {p.key} — {p.name}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-slate-600">No projects yet.</p>
      )}
      {canCreate ? (
        <Link to={`/o/${org}/projects/new`} className="text-blue-700 underline">
          Create project
        </Link>
      ) : null}
    </div>
  );
}
