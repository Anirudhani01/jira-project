import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError, networkError } from '../../lib/api/errors';
import { ThemeProvider } from '../../theme/ThemeProvider';

import { UxEmptyState } from './UxEmptyState';
import { UxErrorState } from './UxErrorState';
import { UxOfflineNotice } from './UxOfflineNotice';
import { UxPermissionDenied } from './UxPermissionDenied';
import { UxSearchEmpty } from './UxSearchEmpty';
import { UxSlowHint } from './UxSlowHint';

function withTheme(ui: React.ReactElement) {
  return (
    <ThemeProvider>
      <MemoryRouter>{ui}</MemoryRouter>
    </ThemeProvider>
  );
}

describe('UxErrorState', () => {
  afterEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  it('renders generic fallback when neither error nor presentation is supplied', () => {
    render(withTheme(<UxErrorState />));
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
  });

  it('shows Retry only when retryable and onRetry is provided', async () => {
    const onRetry = vi.fn();
    const { rerender } = render(
      withTheme(<UxErrorState error={networkError(new TypeError('fetch'))} onRetry={onRetry} />),
    );
    const retry = screen.getByRole('button', { name: 'Retry' });
    await userEvent.click(retry);
    expect(onRetry).toHaveBeenCalledOnce();

    rerender(withTheme(<UxErrorState error={networkError(new TypeError('fetch'))} />));
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();

    rerender(
      withTheme(
        <UxErrorState
          error={new ApiError({ status: 403, code: 'forbidden', title: 'Forbidden' })}
          onRetry={onRetry}
        />,
      ),
    );
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it('prefers presentation over error when both are supplied', () => {
    render(
      withTheme(
        <UxErrorState
          error={networkError(new TypeError('fetch'))}
          presentation={{
            kind: 'generic',
            title: 'Override title',
            description: 'Override description',
            requestId: null,
            showRequestId: false,
            retryable: false,
          }}
        />,
      ),
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Override title');
    expect(screen.queryByText('Connection problem')).not.toBeInTheDocument();
  });

  it('renders in light and dark themes without losing structure', () => {
    const error = new ApiError({
      status: 503,
      code: 'service_unavailable',
      title: 'Unavailable',
      requestId: 'req-demo',
    });
    localStorage.setItem('theme', 'light');
    const { unmount } = render(withTheme(<UxErrorState error={error} />));
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('req-demo')).toBeInTheDocument();
    unmount();

    localStorage.setItem('theme', 'dark');
    render(withTheme(<UxErrorState error={error} />));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});

describe('UxPermissionDenied', () => {
  it('uses region with aria-labelledby, not alert', () => {
    render(
      withTheme(
        <UxPermissionDenied
          capability="the audit log"
          reason="Only organization admins can view audit events."
          backAction={{ label: 'Back to org home', href: '/orgs/acme' }}
        />,
      ),
    );
    const region = screen.getByRole('region', { name: /don't have access/i });
    expect(region).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('UxSearchEmpty', () => {
  it('preserves query in the heading and exposes clear actions', async () => {
    const onClearFilters = vi.fn();
    const onClearQuery = vi.fn();
    render(
      withTheme(
        <UxSearchEmpty
          query="typo-proj"
          scope="projects"
          filtersActive
          onClearFilters={onClearFilters}
          onClearQuery={onClearQuery}
          suggestion={{ label: 'typo-project', onApply: vi.fn() }}
        />,
      ),
    );
    expect(screen.getByRole('heading', { name: /typo-proj/i })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Did you mean "typo-project"?' }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(onClearFilters).toHaveBeenCalledOnce();
  });
});

describe('UxEmptyState', () => {
  it('delegates to EmptyState with optional reason marker', () => {
    render(
      withTheme(
        <UxEmptyState
          title="No issues yet"
          description="Create the first issue."
          reason="no_data"
          action={{ label: 'Create issue', onClick: vi.fn() }}
        />,
      ),
    );
    expect(screen.getByRole('heading', { name: 'No issues yet' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create issue' })).toBeInTheDocument();
  });
});

describe('UxOfflineNotice and UxSlowHint', () => {
  it('renders offline status when offline', () => {
    render(withTheme(<UxOfflineNotice offline variant="banner" />));
    expect(screen.getByRole('status')).toHaveTextContent(/offline/i);
  });

  it('renders nothing when not offline or slow hint hidden', () => {
    const { container: offlineHidden } = render(withTheme(<UxOfflineNotice offline={false} />));
    expect(offlineHidden).toBeEmptyDOMElement();

    const { container: slowHidden } = render(withTheme(<UxSlowHint visible={false} />));
    expect(slowHidden).toBeEmptyDOMElement();
  });

  it('shows slow hint with polite status', () => {
    render(withTheme(<UxSlowHint visible stage="Still saving…" />));
    expect(screen.getByRole('status')).toHaveTextContent('Still saving…');
  });
});
