import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';

import { ProjectTemplatePicker } from './ProjectTemplatePicker';
import { PROJECT_TEMPLATES } from './projectTemplates';

describe('project template picker', () => {
  it('names each card link from its own visible text', () => {
    render(
      <MemoryRouter>
        <ProjectTemplatePicker org="acme" />
      </MemoryRouter>,
    );
    for (const id of ['kanban', 'scrum'] as const) {
      const template = PROJECT_TEMPLATES[id];
      const link = screen.getByRole('link', { name: new RegExp(template.label) });
      // Label in name: the visible title and description are part of the link's name.
      expect(link).toHaveAccessibleName(expect.stringContaining(template.label));
      expect(link).toHaveAccessibleName(expect.stringContaining(template.description));
      expect(link).toHaveAttribute('href', `/o/acme/projects/new?board_type=${id}`);
    }
  });
});
