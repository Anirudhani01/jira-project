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
  it('uses distinct show/hide labels per field label', () => {
    render(
      <>
        <PasswordField label="Current password" />
        <PasswordField label="New password" />
      </>,
    );
    expect(
      screen.getByRole('button', { name: 'Show password for Current password' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Show password for New password' }),
    ).toBeInTheDocument();
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
