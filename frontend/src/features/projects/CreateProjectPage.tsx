import { useParams, useSearchParams } from 'react-router';

import { SimpleFormPage } from '../../components/ui/SimpleFormPage';

import { CreateProjectForm } from './CreateProjectForm';
import { ProjectTemplatePicker } from './ProjectTemplatePicker';
import { ProjectTemplateView } from './ProjectTemplateView';
import { parseProjectTemplate } from './projectTemplates';

export function CreateProjectPage() {
  const { org = '' } = useParams();
  const [searchParams] = useSearchParams();
  const templateId = parseProjectTemplate(searchParams.get('board_type'));
  const step = searchParams.get('step');

  if (!templateId) {
    return (
      <SimpleFormPage title="Choose a project template" titleId="pick-template-title" width="md">
        <p className="text-sm text-fg-muted">
          Pick a template to see what it includes. You will name the project after you choose to use
          it.
        </p>
        <ProjectTemplatePicker org={org} />
      </SimpleFormPage>
    );
  }

  if (step !== 'create') {
    return <ProjectTemplateView org={org} templateId={templateId} />;
  }

  return <CreateProjectForm key={templateId} org={org} templateId={templateId} />;
}
