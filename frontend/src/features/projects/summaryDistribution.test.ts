import { describe, expect, it } from 'vitest';

import {
  barWidth,
  formatCount,
  groupByCategory,
  issueListHref,
  rankByCount,
  segmentWidths,
  sharePercentLabel,
  summaryText,
  type StatusCountRow,
} from './summaryDistribution';

const status = (name: string, category: StatusCountRow['category'], count: number) => ({
  status_id: name,
  name,
  category,
  count,
});

const STATUSES = [
  status('To Do', 'todo', 5),
  status('In Progress', 'in_progress', 2),
  status('In Review', 'in_progress', 1),
  status('Done', 'done', 4),
];

describe('groupByCategory', () => {
  it('groups statuses in To do, In progress, Done order and sums each group', () => {
    const groups = groupByCategory([...STATUSES].reverse());
    expect(groups.map((g) => [g.category, g.count])).toEqual([
      ['todo', 5],
      ['in_progress', 3],
      ['done', 4],
    ]);
    expect(groups[1]?.statuses.map((s) => s.name)).toEqual(['In Review', 'In Progress']);
  });

  it('leaves out a category the workflow has no status for', () => {
    expect(groupByCategory([status('Open', 'todo', 1), status('Closed', 'done', 2)])).toHaveLength(
      2,
    );
  });
});

describe('sharePercentLabel', () => {
  it('shows whole percents, <1% for a tiny share, 0% for none and a dash for no issues', () => {
    expect(sharePercentLabel(1, 4)).toBe('25%');
    expect(sharePercentLabel(2, 3)).toBe('67%');
    expect(sharePercentLabel(1, 500)).toBe('<1%');
    expect(sharePercentLabel(0, 10)).toBe('0%');
    expect(sharePercentLabel(0, 0)).toBe('—');
  });
});

describe('segmentWidths', () => {
  it('is proportional and adds up to 100', () => {
    const widths = segmentWidths([5, 3, 2]);
    expect(widths).toEqual([50, 30, 20]);
  });

  it('keeps a tiny non-zero segment visible by taking room from the larger ones', () => {
    const widths = segmentWidths([499, 1, 0]);
    expect(widths[1]).toBe(2);
    expect(widths[2]).toBe(0);
    expect(widths.reduce((a, b) => a + b, 0)).toBeCloseTo(100);
    expect(widths[0]).toBeCloseTo(98);
  });

  it('is all zero when there is nothing to show', () => {
    expect(segmentWidths([0, 0, 0])).toEqual([0, 0, 0]);
  });
});

describe('summaryText', () => {
  it('reads the whole split out loud', () => {
    expect(summaryText(groupByCategory(STATUSES), 12)).toBe(
      '12 issues: 5 to do, 3 in progress, 4 done',
    );
    expect(summaryText(groupByCategory([status('To Do', 'todo', 1)]), 1)).toBe('1 issue: 1 to do');
  });
});

describe('rankByCount and barWidth', () => {
  it('ranks largest first and breaks ties alphabetically', () => {
    const ranked = rankByCount([
      { id: 'b', name: 'Bug', count: 2, active: true },
      { id: 'e', name: 'Epic', count: 5, active: true },
      { id: 'a', name: 'Alpha', count: 2, active: true },
    ]);
    expect(ranked.map((r) => r.name)).toEqual(['Epic', 'Alpha', 'Bug']);
  });

  it('scales to the largest row with a minimum visible width', () => {
    expect(barWidth(5, 5)).toBe(100);
    expect(barWidth(1, 4)).toBe(25);
    expect(barWidth(1, 1000)).toBe(2);
    expect(barWidth(0, 5)).toBe(0);
    expect(barWidth(3, 0)).toBe(0);
  });
});

describe('issueListHref and formatCount', () => {
  it('builds the list address the count was computed from', () => {
    expect(issueListHref('acme', 'WEB')).toBe('/o/acme/p/WEB/issues');
    expect(issueListHref('acme', 'WEB', { status_category: 'in_progress' })).toBe(
      '/o/acme/p/WEB/issues?status_category=in_progress',
    );
    expect(issueListHref('acme', 'WEB', { assignee: 'none' })).toBe(
      '/o/acme/p/WEB/issues?assignee=none',
    );
  });

  it('formats counts with the organization locale', () => {
    expect(formatCount(1234, 'en-US')).toBe('1,234');
    expect(formatCount(1234, 'de-DE')).toBe('1.234');
    expect(formatCount(7, 'not a locale')).toBe('7');
  });
});
