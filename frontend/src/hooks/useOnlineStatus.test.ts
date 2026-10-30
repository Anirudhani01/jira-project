import { renderHook, act } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { useOnlineStatus } from './useOnlineStatus';

afterEach(() => {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true });
});

describe('useOnlineStatus', () => {
  it('updates when browser fires offline and online', () => {
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current).toBe(true);
    act(() => {
      Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: false });
      window.dispatchEvent(new Event('offline'));
    });
    expect(result.current).toBe(false);
    act(() => {
      Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true });
      window.dispatchEvent(new Event('online'));
    });
    expect(result.current).toBe(true);
  });
});
