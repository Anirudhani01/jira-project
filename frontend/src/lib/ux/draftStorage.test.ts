import { afterEach, describe, expect, it, vi } from 'vitest';

import { ISSUE_DRAFT_STORAGE_KEY } from './draftTypes';
import {
  clearIssueFieldDraftsForIssue,
  loadIssueFieldDrafts,
  persistIssueFieldDrafts,
} from './draftStorage';

afterEach(() => {
  sessionStorage.clear();
});

describe('draftStorage allowlist', () => {
  it('persists and loads summary draft only', () => {
    persistIssueFieldDrafts([
      {
        v: 1,
        org: 'acme',
        issueKey: 'PROJ-1',
        field: 'summary',
        value: 'Draft title',
        baseVersion: 2,
        capturedAt: new Date().toISOString(),
      },
    ]);
    expect(loadIssueFieldDrafts()).toHaveLength(1);
    expect(loadIssueFieldDrafts()[0]?.field).toBe('summary');
  });

  it('skips storage write when payload is unchanged', () => {
    const draft = {
      v: 1 as const,
      org: 'acme',
      issueKey: 'PROJ-1',
      field: 'summary' as const,
      value: 'Draft title',
      baseVersion: 2,
      capturedAt: new Date().toISOString(),
    };
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    persistIssueFieldDrafts([draft]);
    expect(setItem).toHaveBeenCalledTimes(1);
    persistIssueFieldDrafts([{ ...draft, capturedAt: new Date().toISOString() }]);
    expect(setItem).toHaveBeenCalledTimes(1);
    setItem.mockRestore();
  });

  it('clears drafts for an issue', () => {
    persistIssueFieldDrafts([
      {
        v: 1,
        org: 'acme',
        issueKey: 'PROJ-1',
        field: 'description',
        value: 'Body',
        baseVersion: 1,
        capturedAt: new Date().toISOString(),
      },
    ]);
    clearIssueFieldDraftsForIssue('acme', 'PROJ-1');
    expect(sessionStorage.getItem(ISSUE_DRAFT_STORAGE_KEY)).toBeNull();
  });
});
