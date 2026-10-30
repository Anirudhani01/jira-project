import { useMatch } from 'react-router';

/** True only on the project board route (`/o/:org/p/:key/board`). */
export function useBoardShell(): boolean {
  return useMatch({ path: '/o/:org/p/:projectKey/board', end: true }) !== null;
}
