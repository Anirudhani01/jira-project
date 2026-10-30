import { IssueActivitySection } from '../issues/IssueActivitySection';

/** @deprecated Use `IssueActivitySection` (PR 5c tabs). */
export function CommentsSection(props: {
  org: string;
  issueKey: string;
  currentUserId: string;
  canComment: boolean;
  canDeleteAny: boolean;
}) {
  return <IssueActivitySection {...props} />;
}
