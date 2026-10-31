import { useParams, useSearchParams } from 'react-router';

import { NotFoundPage } from '../../app/pages/NotFoundPage';
import { SimpleFormPage } from '../../components/ui/SimpleFormPage';
import { UxPermissionDenied } from '../../components/ux/UxPermissionDenied';
import { ErrorState, LoadingState } from '../../components/ui/States';
import { ApiError } from '../../lib/api/errors';
import { toUxPermissionDeniedProps } from '../../lib/ux/permissionDenied';
import { useOrg } from '../orgs/api';

import { CreateProjectForm } from './CreateProjectForm';
import { ProjectTemplatePicker } from './ProjectTemplatePicker';
import { ProjectTemplateView } from './ProjectTemplateView';
import { parseProjectTemplate } from './projectTemplates';

export function CreateProjectPage() {
  const { org = '' } = useParams();
  const [searchParams] = useSearchParams();
  const templateId = parseProjectTemplate(searchParams.get('board_type'));
  const step = searchParams.get('step');
  const organization = useOrg(org);

  if (step === 'create') {
    if (organization.isPending) return <LoadingState label="Loading organization" />;
    if (organization.error instanceof ApiError && organization.error.status === 404) {
      return <NotFoundPage />;
    }
    if (organization.isError) return <ErrorState error={organization.error} />;
    if (!organization.data.permissions.includes('project.create')) {
      return (
        <SimpleFormPage title="Create a project" titleId="new-project-title" width="md">
          <UxPermissionDenied {...toUxPermissionDeniedProps('create-project', { orgSlug: org })} />
        </SimpleFormPage>
      );
    }
    if (!templateId) {
      return <NotFoundPage />;
    }
    return <CreateProjectForm key={templateId} org={org} templateId={templateId} />;
  }

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

  return <ProjectTemplateView org={org} templateId={templateId} />;
}
