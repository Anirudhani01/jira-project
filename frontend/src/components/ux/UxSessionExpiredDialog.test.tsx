import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ThemeProvider } from '../../theme/ThemeProvider';

import { UxSessionExpiredDialog } from './UxSessionExpiredDialog';

function renderDialog(props: Partial<React.ComponentProps<typeof UxSessionExpiredDialog>> = {}) {
  return render(
    <ThemeProvider>
      <UxSessionExpiredDialog
        open
        recoverableField="summary"
        persistError={null}
        navigationError={null}
        onContinue={vi.fn()}
        onContinueWithoutRecovery={vi.fn()}
        onRetryPersist={vi.fn()}
        {...props}
      />
    </ThemeProvider>,
  );
}

describe('UxSessionExpiredDialog', () => {
  it('explains summary recovery in light theme', () => {
    renderDialog();
    expect(screen.getByRole('dialog', { name: 'Session expired' })).toBeInTheDocument();
    expect(screen.getByText(/restore that text after you sign in/i)).toBeInTheDocument();
  });

  it('calls continue handler', async () => {
    const onContinue = vi.fn();
    renderDialog({ onContinue });
    await userEvent.click(screen.getByRole('button', { name: 'Continue to sign in' }));
    expect(onContinue).toHaveBeenCalledOnce();
  });

  it('shows persist error with retry actions', () => {
    renderDialog({ persistError: 'Storage full' });
    expect(screen.getByRole('alert')).toHaveTextContent('Storage full');
    expect(screen.getByRole('button', { name: 'Retry saving draft' })).toBeInTheDocument();
  });

  it('shows navigation error with retry sign in', () => {
    renderDialog({ navigationError: 'Navigation blocked' });
    expect(screen.getByRole('alert')).toHaveTextContent('Navigation blocked');
    expect(screen.getByRole('button', { name: 'Retry sign in' })).toBeInTheDocument();
  });
});
