import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { PasswordField } from './Form';

function PasswordHarness() {
  const form = useForm({ defaultValues: { password: '' } });
  const [fieldKey, setFieldKey] = useState(0);
  return (
    <form>
      <PasswordField
        key={fieldKey}
        label="New password"
        showStrength
        {...form.register('password')}
      />
      <button
        type="button"
        onClick={() => {
          form.reset();
          setFieldKey((k) => k + 1);
        }}
      >
        Reset
      </button>
    </form>
  );
}

describe('PasswordField', () => {
  it('keeps field labels on inputs and distinct show/hide toggles', () => {
    render(
      <>
        <PasswordField label="Current password" />
        <PasswordField label="New password" />
      </>,
    );
    const current = screen.getByLabelText('Current password');
    const next = screen.getByLabelText('New password');
    expect(current).toHaveAttribute('id');
    expect(next).toHaveAttribute('id');
    const toggles = screen.getAllByRole('button', { name: 'Show password' });
    expect(toggles).toHaveLength(2);
    expect(toggles.some((btn) => btn.getAttribute('aria-controls') === current.id)).toBe(true);
    expect(toggles.some((btn) => btn.getAttribute('aria-controls') === next.id)).toBe(true);
  });

  it('clears strength UI after react-hook-form reset', async () => {
    render(<PasswordHarness />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('New password'), 'Velvet-Harbor-Lantern-93');
    expect(screen.getByText(/Strong password/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reset' }));
    expect(screen.queryByText(/Strong password/)).not.toBeInTheDocument();
  });
});
