import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ThemeProvider } from '../../theme/ThemeProvider';

import { IssueDescriptionSection } from './IssueDescriptionSection';

const OFFLINE_HINT = 'Reconnect to save changes to the server.';

function renderSection(
  overrides: Partial<React.ComponentProps<typeof IssueDescriptionSection>> = {},
) {
  return render(
    <ThemeProvider>
      <IssueDescriptionSection
        description="Hello"
        canEdit
        saving={false}
        editing
        draft="Draft text"
        saveDisabled={false}
        saveDisabledHint={null}
        onStartEdit={vi.fn()}
        onDraftChange={vi.fn()}
        onSave={vi.fn()}
        onCancel={vi.fn()}
        {...overrides}
      />
    </ThemeProvider>,
  );
}

describe('IssueDescriptionSection offline save', () => {
  it('disables Save and shows hint when offline', () => {
    renderSection({ saveDisabled: true, saveDisabledHint: OFFLINE_HINT });
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent(OFFLINE_HINT);
  });

  it('enables Save when online', async () => {
    const onSave = vi.fn();
    renderSection({ onSave });
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledOnce();
  });
});
