import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router';
import { z } from 'zod';

import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { FormError, SubmitButton, TextField } from '../../components/ui/Form';
import { SimpleFormPage } from '../../components/ui/SimpleFormPage';
import { ApiError } from '../../lib/api/errors';
import { describeError } from '../../lib/forms';
import { applyServerErrorsWithFocus } from '../../lib/ux/formFocus';
import { isRbacForbidden, permissionDeniedInlineMessage } from '../../lib/ux/permissionDenied';

import { useCreateProject } from './api';
import { PROJECT_TEMPLATES, type ProjectTemplateId } from './projectTemplates';

const schema = z.object({
  name: z.string().trim().min(1, 'Enter a name.').max(100),
  key: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z][A-Z0-9]{1,9}$/, 'Use 2–10 letters or digits, starting with a letter.'),
  board_type: z.enum(['kanban', 'scrum']),
});
type Values = z.infer<typeof schema>;

const FIELD_ORDER = ['name', 'key'] as const;

/** Create step; remounted when `templateId` changes so `board_type` matches the URL immediately. */
export function CreateProjectForm({
  org,
  templateId,
}: {
  org: string;
  templateId: ProjectTemplateId;
}) {
  const create = useCreateProject(org);
  const navigate = useNavigate();
  const template = PROJECT_TEMPLATES[templateId];
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', key: '', board_type: templateId },
  });
  const { errors } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const project = await create.mutateAsync({ ...values, board_type: templateId });
      await navigate(`/o/${org}/p/${project.key}/board`);
    } catch (error) {
      applyServerErrorsWithFocus(
        error,
        FIELD_ORDER,
        FIELD_ORDER,
        form.setError,
        form.control,
        form.setFocus,
      );
    }
  });
  const failure =
    create.error && !(create.error instanceof ApiError && [409, 422].includes(create.error.status))
      ? isRbacForbidden(create.error)
        ? permissionDeniedInlineMessage(create.error, 'create-project')
        : describeError(create.error)
      : null;

  return (
    <SimpleFormPage title="Create a project" titleId="new-project-title" width="md">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-fg-muted">Template:</span>
          <Badge tone="accent">{template.label}</Badge>
          <Button variant="link" size="sm" className="h-auto p-0" asChild>
            <Link to={`/o/${org}/projects/new?board_type=${templateId}`}>View template</Link>
          </Button>
        </div>
        <form onSubmit={(e) => void onSubmit(e)} noValidate className="space-y-4">
          <FormError>{failure}</FormError>
          <input type="hidden" {...form.register('board_type')} />
          <TextField label="Name" error={errors.name?.message} {...form.register('name')} />
          <TextField
            label="Key"
            hint="Prefix for issue keys, e.g. WEB-1. It cannot be changed later."
            error={errors.key?.message}
            {...form.register('key')}
          />
          <SubmitButton pending={create.isPending}>Create project</SubmitButton>
        </form>
      </div>
    </SimpleFormPage>
  );
}
