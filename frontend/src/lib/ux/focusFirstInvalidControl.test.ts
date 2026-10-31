import { describe, expect, it, vi } from 'vitest';

import { focusFirstInvalidControl } from './focusFirstInvalidControl';

describe('focusFirstInvalidControl', () => {
  it('focuses the first field with an error in order', () => {
    const second = vi.fn();
    const first = vi.fn();
    focusFirstInvalidControl([
      { hasError: false, focus: first },
      { hasError: true, focus: second },
      { hasError: true, focus: vi.fn() },
    ]);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('does nothing when no errors', () => {
    const focus = vi.fn();
    focusFirstInvalidControl([{ hasError: false, focus }]);
    expect(focus).not.toHaveBeenCalled();
  });
});
