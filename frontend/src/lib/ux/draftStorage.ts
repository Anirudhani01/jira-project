import {
  ISSUE_DRAFT_MAX_DESCRIPTION,
  ISSUE_DRAFT_MAX_SUMMARY,
  ISSUE_DRAFT_STORAGE_KEY,
  type IssueFieldDraftPayload,
} from './draftTypes';
import { isIssueDraftField } from './issueDetailDraft';

function isValidPayload(value: unknown): value is IssueFieldDraftPayload {
  if (typeof value !== 'object' || value === null) return false;
  const o = value as Record<string, unknown>;
  if (o.v !== 1) return false;
  if (typeof o.org !== 'string' || typeof o.issueKey !== 'string') return false;
  if (typeof o.field !== 'string' || !isIssueDraftField(o.field)) return false;
  if (typeof o.value !== 'string' || typeof o.baseVersion !== 'number') return false;
  if (typeof o.capturedAt !== 'string') return false;
  const max = o.field === 'summary' ? ISSUE_DRAFT_MAX_SUMMARY : ISSUE_DRAFT_MAX_DESCRIPTION;
  return o.value.length <= max;
}

function trimPayload(payload: IssueFieldDraftPayload): IssueFieldDraftPayload {
  const max = payload.field === 'summary' ? ISSUE_DRAFT_MAX_SUMMARY : ISSUE_DRAFT_MAX_DESCRIPTION;
  return { ...payload, value: payload.value.slice(0, max) };
}

function draftIdentity(d: IssueFieldDraftPayload): string {
  return `${d.org}:${d.issueKey}:${d.field}`;
}

function draftContentMatches(a: IssueFieldDraftPayload, b: IssueFieldDraftPayload): boolean {
  return (
    a.value === b.value && a.baseVersion === b.baseVersion && draftIdentity(a) === draftIdentity(b)
  );
}

/** Persist allowlisted drafts after user confirms session expiry. Skips storage I/O when unchanged. */
export function persistIssueFieldDrafts(drafts: IssueFieldDraftPayload[]): void {
  if (drafts.length === 0) return;
  const sanitized = drafts.map((d) => trimPayload(d));
  for (const draft of sanitized) {
    if (!isValidPayload(draft)) {
      throw new Error('Draft payload failed allowlist validation.');
    }
  }
  const existing = loadIssueFieldDrafts();
  const unchanged = sanitized.every((draft) =>
    existing.some((entry) => draftContentMatches(entry, draft)),
  );
  if (unchanged && existing.length === sanitized.length) {
    return;
  }
  try {
    sessionStorage.setItem(ISSUE_DRAFT_STORAGE_KEY, JSON.stringify(sanitized));
  } catch {
    throw new Error('Could not save draft to browser storage.');
  }
}

export function loadIssueFieldDrafts(): IssueFieldDraftPayload[] {
  try {
    const raw = sessionStorage.getItem(ISSUE_DRAFT_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidPayload);
  } catch {
    return [];
  }
}

export function clearIssueFieldDraftsForIssue(org: string, issueKey: string): void {
  const remaining = loadIssueFieldDrafts().filter(
    (d) => !(d.org === org && d.issueKey === issueKey),
  );
  if (remaining.length === 0) {
    sessionStorage.removeItem(ISSUE_DRAFT_STORAGE_KEY);
    return;
  }
  sessionStorage.setItem(ISSUE_DRAFT_STORAGE_KEY, JSON.stringify(remaining));
}

export function discardIssueFieldDraft(org: string, issueKey: string, field: string): void {
  const remaining = loadIssueFieldDrafts().filter(
    (d) => !(d.org === org && d.issueKey === issueKey && d.field === field),
  );
  if (remaining.length === 0) {
    sessionStorage.removeItem(ISSUE_DRAFT_STORAGE_KEY);
    return;
  }
  sessionStorage.setItem(ISSUE_DRAFT_STORAGE_KEY, JSON.stringify(remaining));
}
