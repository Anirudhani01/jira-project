import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useSearchParams } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { GlobalSearchBar } from './GlobalSearchBar';

vi.mock('../../features/projects/api', () => ({
  useProjects: () => ({
    data: [
      { key: 'WEB', name: 'Website', board_type: 'kanban', archived: false, my_role: 'admin' },
      { key: 'MOB', name: 'Mobile App', board_type: 'scrum', archived: false, my_role: 'admin' },
    ],
    isPending: false,
    isError: false,
  }),
}));

function orgHomeSearch(initial = '') {
  return (
    <MemoryRouter initialEntries={[`/o/demo${initial ? `?${initial}` : ''}`]}>
      <Routes>
        <Route path="/o/:org" element={<GlobalSearchBar orgDashboard />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('GlobalSearchBar', () => {
  it('shows no-results panel without rewriting the query', async () => {
    const user = userEvent.setup();
    render(orgHomeSearch());

    const input = screen.getByRole('combobox', { name: /search projects/i });
    await user.click(input);
    await user.type(input, 'zzzz');

    expect(input).toHaveValue('zzzz');
    expect(screen.getByText(/No projects for/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /clear search/i })).toBeInTheDocument();
  });

  it('clear search removes only q from the URL', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/o/demo?q=nope&status=archived']}>
        <Routes>
          <Route
            path="/o/:org"
            element={
              <>
                <GlobalSearchBar orgDashboard />
                <UrlEcho />
              </>
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('combobox', { name: /search projects/i }));
    await user.click(screen.getByRole('button', { name: /clear search/i }));

    expect(screen.getByTestId('url')).toHaveTextContent('status=archived');
    expect(screen.getByTestId('url')).not.toHaveTextContent('q=');
  });

  it('applies suggestion only after explicit click', async () => {
    const user = userEvent.setup();
    render(orgHomeSearch('q=webb'));

    await user.click(screen.getByRole('combobox', { name: /search projects/i }));
    const suggest = await screen.findByRole('button', { name: /did you mean/i });
    await user.click(suggest);

    expect(screen.getByRole('combobox')).toHaveValue('WEB');
  });
});

function UrlEcho() {
  const [params] = useSearchParams();
  return <span data-testid="url">{params.toString()}</span>;
}
