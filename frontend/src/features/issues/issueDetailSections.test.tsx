import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { IssueDescriptionSection } from './IssueDescriptionSection';

describe('IssueDescriptionSection', () => {
  it('renders markdown in preview while editing', async () => {
    function Harness() {
      const [draft, setDraft] = useState('**Ship** it');
      return (
        <IssueDescriptionSection
          description={null}
          canEdit
          saving={false}
          editing
          draft={draft}
          onStartEdit={() => undefined}
          onDraftChange={setDraft}
          onSave={vi.fn()}
          onCancel={vi.fn()}
        />
      );
    }
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(screen.getByText('Ship')).toBeInTheDocument();
    expect(screen.getByText('Ship').tagName).toBe('STRONG');
  });
});
