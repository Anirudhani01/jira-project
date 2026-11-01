import { renderHook } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { useUnsavedChangesWarning } from './useUnsavedChangesWarning';

function routerWrapper({ children }: { children: React.ReactNode }) {
  const router = createMemoryRouter([{ path: '/', element: children }], { initialEntries: ['/'] });
  return <RouterProvider router={router} />;
}

describe('useUnsavedChangesWarning', () => {
  it('registers beforeunload when dirty', () => {
    const add = vi.spyOn(window, 'addEventListener');
    renderHook(
      () => {
        useUnsavedChangesWarning(true);
      },
      { wrapper: routerWrapper },
    );
    expect(add).toHaveBeenCalledWith('beforeunload', expect.any(Function), { capture: true });
    add.mockRestore();
  });

});
