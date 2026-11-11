import { Navigate, Outlet, useLocation, useParams } from 'react-router';

import { useProject } from './api';

/** Old project keys keep working in the API; the address bar moves to the current key. */
export function ProjectKeyRedirect() {
  const { org = '', key = '' } = useParams();
  const location = useLocation();
  const project = useProject(org, key);
  const canonical = project.data?.key;
  const state: unknown = location.state;

  if (canonical && canonical !== key.toUpperCase()) {
    const segments = location.pathname.split('/');
    const at = segments.findIndex(
      (segment, index) =>
        segments[index - 1] === 'p' && segment.toLowerCase() === key.toLowerCase(),
    );
    if (at > 0) {
      segments[at] = canonical;
      return (
        <Navigate
          to={{ pathname: segments.join('/'), search: location.search, hash: location.hash }}
          state={state}
          replace
        />
      );
    }
  }
  return <Outlet />;
}
