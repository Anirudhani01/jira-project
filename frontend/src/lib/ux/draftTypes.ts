/** Allowlisted issue-detail fields that may be persisted after session-expiry confirmation. */
export type IssueDraftField = 'summary' | 'description';

export interface IssueFieldDraftPayload {
  v: 1;
  org: string;
  issueKey: string;
  field: IssueDraftField;
  value: string;
  baseVersion: number;
  capturedAt: string;
}

export const ISSUE_DRAFT_STORAGE_KEY = 'ux:issue-field-drafts:v1';

export const ISSUE_DRAFT_MAX_SUMMARY = 255;

export const ISSUE_DRAFT_MAX_DESCRIPTION = 32_768;
