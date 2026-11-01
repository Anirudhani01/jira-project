import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';

import { json, mockApi, problem } from '../../test/api';

import { orgSettingsKey } from './api';
import { OrgFormatProvider } from './OrgFormatProvider';
import { useOrgFormatters } from './useOrgFormatters';

const ORG_SETTINGS = {
  timezone: 'Asia/Tokyo',
  locale: 'ja-JP',
  updated_at: '2026-10-27T00:00:00Z',
};

function Probe() {
  const orgFormat = useOrgFormatters();
  return (
    <div>
      <span data-testid="tz">{orgFormat.timezone}</span>
      <span data-testid="locale">{orgFormat.locale}</span>
      <span data-testid="fallback">{String(orgFormat.isFallback)}</span>
      <span data-testid="created">{orgFormat.formatDateTime('2026-06-15T12:00:00.000Z')}</span>
    </div>
  );
}

function renderProvider(client: QueryClient) {
  return render(
    <QueryClientProvider client={client}>
      <OrgFormatProvider orgSlug="acme">
        <Probe />
      </OrgFormatProvider>
    </QueryClientProvider>,
  );
}

describe('OrgFormatProvider', () => {
  it('uses UTC/en-US fallback while settings are loading', async () => {
    mockApi({
      'GET /orgs/acme/settings': () =>
        new Promise((resolve) => {
          window.setTimeout(() => {
            resolve(json(ORG_SETTINGS));
          }, 100);
        }),
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderProvider(client);
    expect(screen.getByTestId('fallback')).toHaveTextContent('true');
    expect(screen.getByTestId('tz')).toHaveTextContent('UTC');
    await waitFor(() => {
      expect(screen.getByTestId('fallback')).toHaveTextContent('false');
    });
  });

  it('uses org settings from the shared React Query cache', async () => {
    mockApi({
      'GET /orgs/acme/settings': () => json(ORG_SETTINGS),
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: 60_000 } },
    });
    client.setQueryData(orgSettingsKey('acme'), ORG_SETTINGS);
    renderProvider(client);
    await waitFor(() => {
      expect(screen.getByTestId('fallback')).toHaveTextContent('false');
    });
    expect(screen.getByTestId('tz')).toHaveTextContent('Asia/Tokyo');
    expect(screen.getByTestId('locale')).toHaveTextContent('ja-JP');
  });

  it('falls back when settings request fails', async () => {
    mockApi({
      'GET /orgs/acme/settings': () => problem(500, 'internal_error'),
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderProvider(client);
    await waitFor(() => {
      expect(screen.getByTestId('fallback')).toHaveTextContent('true');
    });
    expect(screen.getByTestId('tz')).toHaveTextContent('UTC');
    expect(screen.getByTestId('locale')).toHaveTextContent('en-US');
  });

  it('refreshes formatters when settings cache updates after preferences save', async () => {
    mockApi({
      'GET /orgs/acme/settings': () =>
        json({ timezone: 'UTC', locale: 'en-US', updated_at: '2026-10-27T00:00:00Z' }),
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: 60_000 } },
    });
    renderProvider(client);
    await waitFor(() => {
      expect(screen.getByTestId('locale')).toHaveTextContent('en-US');
    });
    client.setQueryData(orgSettingsKey('acme'), ORG_SETTINGS);
    await waitFor(() => {
      expect(screen.getByTestId('locale')).toHaveTextContent('ja-JP');
    });
    expect(screen.getByTestId('tz')).toHaveTextContent('Asia/Tokyo');
  });
});
