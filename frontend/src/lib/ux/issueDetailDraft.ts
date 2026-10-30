import type { IssueDraftField, IssueFieldDraftPayload } from './draftTypes';

export type IssueDetailDraftSnapshot = Omit<IssueFieldDraftPayload, 'v' | 'capturedAt'>;

type SnapshotGetter = () => IssueDetailDraftSnapshot | null;

let snapshotGetter: SnapshotGetter | null = null;

/** Pilot-only: issue detail registers while mounted. */
export function registerIssueDetailDraftSnapshot(getter: SnapshotGetter | null): void {
  snapshotGetter = getter;
}

export function readIssueDetailDraftSnapshot(): IssueDetailDraftSnapshot | null {
  return snapshotGetter?.() ?? null;
}

export function snapshotToPayload(snapshot: IssueDetailDraftSnapshot): IssueFieldDraftPayload {
  return {
    v: 1,
    ...snapshot,
    capturedAt: new Date().toISOString(),
  };
}

export function isIssueDraftField(value: string): value is IssueDraftField {
  return value === 'summary' || value === 'description';
}
