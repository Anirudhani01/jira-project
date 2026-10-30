import { describe, expect, it } from 'vitest';

import { statusLozengeAppearance } from './statusStyles';

describe('statusLozengeAppearance', () => {
  it('gives In Review a distinct palette from In Progress', () => {
    const progress = statusLozengeAppearance('In Progress', 'in_progress');
    const review = statusLozengeAppearance('In Review', 'in_progress');
    expect(progress).not.toEqual(review);
    expect(review).toContain('--status-in-review-soft');
    expect(progress).toContain('--status-in-progress-soft');
  });

  it('falls back to category when the name is custom', () => {
    expect(statusLozengeAppearance('Blocked', 'todo')).toContain('--status-todo');
    expect(statusLozengeAppearance('Shipped', 'done')).toContain('--status-done');
  });
});
