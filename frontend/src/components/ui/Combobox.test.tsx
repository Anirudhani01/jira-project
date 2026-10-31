import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';

import { Combobox, type ComboOption } from './Combobox';

const OPTIONS: ComboOption[] = [
  { value: 'u1', label: 'Ann Example', description: 'ann@example.com' },
  { value: 'u2', label: 'Bob Stone', description: 'bob@example.com' },
  { value: 'u3', label: 'Cy Park' },
];

function Single({ onSearch }: { onSearch?: (q: string) => void }) {
  const [value, setValue] = useState<string | null>(null);
  return (
    <Combobox
      label="Assignee"
      options={OPTIONS}
      value={value}
      onChange={setValue}
      clearLabel="Unassigned"
      {...(onSearch ? { onSearch } : {})}
    />
  );
}

function Multi() {
  const [value, setValue] = useState<string[]>([]);
  return (
    <Combobox
      label="Labels"
      multiple
      options={OPTIONS}
      value={value}
      onChange={setValue}
      placeholder="None"
    />
  );
}

describe('Combobox', () => {
  it('is a combobox named by its label and shows the current choice', () => {
    render(<Single />);
    const trigger = screen.getByRole('combobox', { name: /^Assignee/ });
    expect(trigger).toHaveAccessibleName('Assignee Unassigned');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('filters by typing, selects with the keyboard and closes', async () => {
    render(<Single />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('combobox', { name: /^Assignee/ }));
    await user.type(await screen.findByRole('combobox', { name: 'Search Assignee' }), 'bob');
    const list = screen.getByRole('listbox');
    expect(within(list).queryByText('Ann Example')).toBeNull();
    await user.keyboard('{Enter}');
    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: /^Assignee/ })).toHaveAccessibleName(
        'Assignee Bob Stone',
      );
    });
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('matches on the description too and can clear back to the empty choice', async () => {
    render(<Single />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('combobox', { name: /^Assignee/ }));
    await user.type(await screen.findByRole('combobox', { name: 'Search Assignee' }), 'ann@');
    await user.click(await screen.findByRole('option', { name: /Ann Example/ }));
    expect(screen.getByRole('combobox', { name: /^Assignee/ })).toHaveAccessibleName(
      'Assignee Ann Example',
    );
    await user.click(screen.getByRole('combobox', { name: /^Assignee/ }));
    await user.click(await screen.findByRole('option', { name: 'Unassigned' }));
    expect(screen.getByRole('combobox', { name: /^Assignee/ })).toHaveAccessibleName(
      'Assignee Unassigned',
    );
  });

  it('supports multiple selection and keeps the list open', async () => {
    render(<Multi />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('combobox', { name: /^Labels/ }));
    await user.click(await screen.findByRole('option', { name: /Ann Example/ }));
    await user.click(screen.getByRole('option', { name: /Cy Park/ }));
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /^Labels/ })).toHaveAccessibleName(
      'Labels Ann Example, Cy Park',
    );
    await user.click(screen.getByRole('option', { name: /Ann Example/ }));
    expect(screen.getByRole('combobox', { name: /^Labels/ })).toHaveAccessibleName(
      'Labels Cy Park',
    );
  });

  it('reports typed text for server-side search and does not filter locally', async () => {
    const onSearch = vi.fn();
    render(<Single onSearch={onSearch} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('combobox', { name: /^Assignee/ }));
    await user.type(await screen.findByRole('combobox', { name: 'Search Assignee' }), 'zzz');
    expect(onSearch).toHaveBeenLastCalledWith('zzz');
    expect(screen.getAllByRole('option').length).toBeGreaterThan(1);
  });

  it('shows an inline error and marks the control invalid', () => {
    render(
      <Combobox
        label="Parent"
        options={[]}
        value={null}
        onChange={() => undefined}
        error="Pick a parent."
      />,
    );
    const trigger = screen.getByRole('combobox', { name: /^Parent/ });
    expect(trigger).toHaveAttribute('aria-invalid', 'true');
    expect(trigger).toHaveAccessibleDescription('Pick a parent.');
  });
});
