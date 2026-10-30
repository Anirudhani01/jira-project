import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  notifyConfirmedLogout,
  registerEstablishedSessionLifecycle,
  resetEstablishedSessionLifecycleForTests,
} from './establishedSession';

afterEach(() => {
  resetEstablishedSessionLifecycleForTests();
});

describe('establishedSession lifecycle', () => {
  it('notifies provider to clear had-established flag on confirmed logout', () => {
    const onConfirmedLogout = vi.fn();
    registerEstablishedSessionLifecycle({ onConfirmedLogout });
    notifyConfirmedLogout();
    expect(onConfirmedLogout).toHaveBeenCalledOnce();
  });
});
