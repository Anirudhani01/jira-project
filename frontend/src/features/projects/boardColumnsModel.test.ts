import {
  assignStatus,
  hasErrors,
  moveColumn,
  toRequest,
  validateColumns,
  type ColumnDraft,
} from './boardColumnsModel';

const col = (uid: string, statusIds: string[], over: Partial<ColumnDraft> = {}): ColumnDraft => ({
  id: uid,
  uid,
  name: uid,
  wip: '',
  statusIds,
  ...over,
});

describe('validateColumns', () => {
  it('accepts a complete mapping', () => {
    expect(hasErrors(validateColumns([col('a', ['s1']), col('b', ['s2'])], ['s1', 's2']))).toBe(
      false,
    );
  });
  it('requires every status to be in a column', () => {
    const e = validateColumns([col('a', ['s1'])], ['s1', 's2']);
    expect(e.unmapped).toEqual(['s2']);
    expect(e.form).toBe('Every status must be in exactly one column.');
  });
  it('flags blank names, bad WIP limits and too many columns', () => {
    const e = validateColumns(
      [col('a', ['s1'], { name: '  ', wip: '0' }), col('b', [], { wip: '12' })],
      ['s1'],
    );
    expect(e.names).toEqual({ a: 'Enter a column name.' });
    expect(Object.keys(e.wip)).toEqual(['a']);
    const many = Array.from({ length: 21 }, (_, i) => col(`c${i}`, i === 0 ? ['s1'] : []));
    expect(validateColumns(many, ['s1']).form).toMatch(/at most 20/);
    expect(validateColumns([], []).form).toMatch(/at least one/);
  });
});

describe('editing helpers', () => {
  it('moves columns and ignores out-of-range moves', () => {
    const cols = [col('a', []), col('b', []), col('c', [])];
    expect(moveColumn(cols, 2, -1).map((c) => c.uid)).toEqual(['a', 'c', 'b']);
    expect(moveColumn(cols, 0, -1)).toBe(cols);
    expect(moveColumn(cols, 2, 1)).toBe(cols);
  });
  it('keeps a status in exactly one column', () => {
    const cols = [col('a', ['s1', 's2']), col('b', [])];
    const moved = assignStatus(cols, 's1', 'b');
    expect(moved.map((c) => c.statusIds)).toEqual([['s2'], ['s1']]);
    expect(assignStatus(moved, 's1', null).map((c) => c.statusIds)).toEqual([['s2'], []]);
  });
  it('builds the PUT body, omitting ids of new columns', () => {
    const body = toRequest([
      col('a', ['s1'], { wip: '5', name: ' To Do ' }),
      { uid: 'n', name: 'New', wip: '', statusIds: [] },
    ]);
    expect(body).toEqual({
      columns: [
        { id: 'a', name: 'To Do', wip_limit: 5, status_ids: ['s1'] },
        { name: 'New', wip_limit: null, status_ids: [] },
      ],
    });
  });
});
