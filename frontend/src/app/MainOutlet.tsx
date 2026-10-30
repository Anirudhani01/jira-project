import { Outlet, useLocation, useRoutes, type Location } from 'react-router';

import { IssueDetailModal } from '../features/issues/IssueDetailModal';
import {
  isIssueDetailPath,
  readIssueDetailModalState,
} from '../features/issues/issueDetailNavigation';

import { appShellChildRoutes } from './routes';

function IssueDetailModalOutlet({ backgroundLocation }: { backgroundLocation: Location }) {
  const background = useRoutes(appShellChildRoutes, backgroundLocation);
  return (
    <>
      {background}
      <IssueDetailModal />
    </>
  );
}

/** Renders shell routes; keeps background page visible when issue detail is modal. */
export function MainOutlet() {
  const location = useLocation();
  const modalState = readIssueDetailModalState(location.state);
  const issueModal = Boolean(modalState && isIssueDetailPath(location.pathname));

  if (issueModal && modalState) {
    return <IssueDetailModalOutlet backgroundLocation={modalState.backgroundLocation} />;
  }

  return <Outlet />;
}
