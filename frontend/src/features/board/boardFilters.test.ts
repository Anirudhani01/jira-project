import type { Issue } from '../../lib/api/types';

import {
  clearBoardSearchQuery,
  collectBoardFilterMeta,
  matchesBoardFilters,
  parseBoardFilters,
  resetBoardFiltersPreservingQuery,
  writeBoardFilters,
} from './boardFilters';
import { board } from './board.test.fixtures';

const ME = '11111111-1111-1111-1111-111111111111';

function withAssignee(issue: Issue, id: string | null, name = 'User'): Issue {
  return {
    ...issue,
    assignee: id ? { id, display_name: name } : null,
  };
}

describe('boardFilters', () => {
  it('round-trips URL search params', () => {
    const params = new URLSearchParams();
    const written = writeBoardFilters(params, {
      q: 'login',
      mine: true,
      assignees: ['a', 'b'],
      typeId: 't1',
      labelId: 'l1',
    });
    expect(parseBoardFilters(written)).toEqual({
      q: 'login',
      mine: true,
      assignees: ['a', 'b'],
      typeId: 't1',
      labelId: 'l1',
    });
  });

  it('filters by query, mine, assignee, type, and label', () => {
    const base = board().columns[0]?.issues[0] as Issue;
    const labeled: Issue = {
      ...base,
      key: 'WEB-9',
      summary: 'Fix login',
      labels: [{ id: 'lbl', name: 'bug', color: '#f00' }],
      type: { id: 'bug', name: 'Bug', kind: 'standard' },
    };
    const filters = parseBoardFilters(new URLSearchParams('q=login&mine=1&type=bug&label=lbl'));
    expect(matchesBoardFilters(labeled, filters, ME)).toBe(false);
    expect(matchesBoardFilters(withAssignee(labeled, ME), filters, ME)).toBe(true);
    expect(
      matchesBoardFilters(
        withAssignee(labeled, ME),
        parseBoardFilters(new URLSearchParams('assignee=other')),
        ME,
      ),
    ).toBe(false);
  });

  it('resetBoardFiltersPreservingQuery clears quick filters but keeps q', () => {
    const search = new URLSearchParams('q=login&mine=1&type=bug&foo=bar');
    const next = resetBoardFiltersPreservingQuery(search);
    expect(next.get('q')).toBe('login');
    expect(next.get('mine')).toBeNull();
    expect(next.get('type')).toBeNull();
    expect(next.get('foo')).toBe('bar');
  });

  it('clearBoardSearchQuery removes only q', () => {
    const search = new URLSearchParams('q=login&mine=1');
    const next = clearBoardSearchQuery(search);
    expect(next.get('q')).toBeNull();
    expect(next.get('mine')).toBe('1');
  });

  it('collects assignees, types, and labels from all columns', () => {
    const b = board();
    const meta = collectBoardFilterMeta(b);
    expect(meta.types.length).toBeGreaterThan(0);
    expect(meta.assignees).toEqual([]);
  });
});
