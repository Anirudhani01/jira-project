import { useLocation, useRoutes } from 'react-router';

import { IssueDetailModal } from '../features/issues/IssueDetailModal';
import {
  isIssueDetailPath,
  readIssueDetailModalState,
} from '../features/issues/issueDetailNavigation';

import { appShellChildRoutes } from './routes';

/** Renders shell routes; keeps background page visible when issue detail is modal. */
export function MainOutlet() {
  const location = useLocation();
  const modalState = readIssueDetailModalState(location.state);
  const issueModal = Boolean(modalState && isIssueDetailPath(location.pathname));
  const mainLocation = issueModal && modalState ? modalState.backgroundLocation : location;
  const element = useRoutes(appShellChildRoutes, mainLocation);

  return (
    <>
      {element}
      {issueModal ? <IssueDetailModal /> : null}
    </>
  );
}
