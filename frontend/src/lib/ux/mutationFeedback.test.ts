import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createFeedbackInvocationId,
  resetMutationFeedbackForTests,
  showSuccessToast,
} from './mutationFeedback';

describe('mutationFeedback', () => {
  afterEach(() => {
    vi.useRealTimers();
    resetMutationFeedbackForTests();
  });

  it('creates distinct invocation ids', () => {
    const a = createFeedbackInvocationId();
    const b = createFeedbackInvocationId();
    expect(a).not.toBe(b);
  });

  it('suppresses duplicate success callbacks for the same invocation id', () => {
    resetMutationFeedbackForTests();
    const toast = vi.fn();
    const id = createFeedbackInvocationId();

    expect(showSuccessToast(toast, { feedbackInvocationId: id, title: 'Saved' })).toBe(true);
    expect(showSuccessToast(toast, { feedbackInvocationId: id, title: 'Saved again' })).toBe(false);

    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith({
      title: 'Saved',
      variant: 'success',
    });
  });

  it('allows rapid intentional repeats with new invocation ids', () => {
    resetMutationFeedbackForTests();
    const toast = vi.fn();

    const first = createFeedbackInvocationId();
    const second = createFeedbackInvocationId();

    expect(showSuccessToast(toast, { feedbackInvocationId: first, title: 'Once' })).toBe(true);
    expect(showSuccessToast(toast, { feedbackInvocationId: second, title: 'Twice' })).toBe(true);

    expect(toast).toHaveBeenCalledTimes(2);
  });

  it('does not show when invocation id is empty', () => {
    resetMutationFeedbackForTests();
    const toast = vi.fn();
    expect(showSuccessToast(toast, { feedbackInvocationId: '  ', title: 'Nope' })).toBe(false);
    expect(toast).not.toHaveBeenCalled();
  });

  it('prunes entries older than the maximum age on the next show', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const toast = vi.fn();
    const id = 'aged-out-id';

    expect(showSuccessToast(toast, { feedbackInvocationId: id, title: 'First' })).toBe(true);
    expect(showSuccessToast(toast, { feedbackInvocationId: id, title: 'Duplicate' })).toBe(false);

    vi.setSystemTime(new Date('2026-01-01T00:11:00Z'));
    expect(showSuccessToast(toast, { feedbackInvocationId: id, title: 'After expiry' })).toBe(true);
    expect(toast).toHaveBeenCalledTimes(2);
  });

  it('prunes oldest entries when the registry exceeds the maximum size', () => {
    const toast = vi.fn();
    for (let i = 0; i < 200; i += 1) {
      expect(showSuccessToast(toast, { feedbackInvocationId: `id-${String(i)}`, title: 'x' })).toBe(
        true,
      );
    }
    expect(toast).toHaveBeenCalledTimes(200);

    expect(showSuccessToast(toast, { feedbackInvocationId: 'id-200', title: 'new' })).toBe(true);
    expect(showSuccessToast(toast, { feedbackInvocationId: 'id-0', title: 'replay' })).toBe(true);
    expect(
      showSuccessToast(toast, { feedbackInvocationId: 'id-199', title: 'still blocked' }),
    ).toBe(false);
    expect(toast).toHaveBeenCalledTimes(202);
  });
});
