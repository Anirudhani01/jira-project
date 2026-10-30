import { describe, expect, it } from 'vitest';

import type { Board, BoardColumn, Issue } from '../../lib/api/types';

import { columnVisualKind } from './columnStatusStyle';
import { card, TODO, DONE } from './board.test.fixtures';

function col(id: string, name: string, statusId: string, issues: Issue[]): BoardColumn {
  return {
    id,
    name,
    position: 0,
    wip_limit: null,
    status_ids: [statusId],
    count: issues.length,
    over_wip_limit: false,
    issues,
  };
}

function boardWith(columns: BoardColumn[]): Board {
  return {
    project_key: 'WEB',
    board_type: 'scrum',
    truncated: false,
    sprint: null,
    columns,
    transitions: [],
  };
}

describe('columnVisualKind', () => {
  it('uses status category from column issues', () => {
    const todoCol = col('1', 'To Do', TODO, [
      card('A', TODO, 1, { status: { id: TODO, name: 'To Do', category: 'todo' } }),
    ]);
    expect(columnVisualKind(todoCol, boardWith([todoCol]))).toBe('todo');
  });

  it('detects in review from status name when category is in_progress', () => {
    const reviewId = 's-review';
    const issue = card('R', reviewId, 1, {
      status: { id: reviewId, name: 'In Review', category: 'in_progress' },
    });
    const reviewCol = col('1', 'In Review', reviewId, [issue]);
    expect(columnVisualKind(reviewCol, boardWith([reviewCol]))).toBe('in_review');
  });

  it('falls back to column name when the column has no issues on the board', () => {
    const reviewCol = col('1', 'In Review', 'empty-status', []);
    const doneCol = col('2', 'Done', DONE, []);
    const b = boardWith([reviewCol, doneCol]);
    expect(columnVisualKind(reviewCol, b)).toBe('in_review');
    expect(columnVisualKind(doneCol, b)).toBe('done');
  });

  it('uses done category from another column’s issue with matching status id', () => {
    const doneIssue = card('D', DONE, 1, {
      status: { id: DONE, name: 'Done', category: 'done' },
    });
    const primary = col('1', 'Done', DONE, [doneIssue]);
    const emptyTwin = col('2', 'Done copy', DONE, []);
    const b = boardWith([primary, emptyTwin]);
    expect(columnVisualKind(emptyTwin, b)).toBe('done');
  });
});
