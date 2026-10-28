import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useNavigate, useParams } from 'react-router';
import { z } from 'zod';

import { FormError, SubmitButton, TextField } from '../../components/ui/Form';
import { ApiError } from '../../lib/api/errors';
import { applyServerErrors, describeError } from '../../lib/forms';

import { useCreateProject } from './api';

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

export function CreateProjectPage() {
  const { org = '' } = useParams();
  const create = useCreateProject(org);
  const navigate = useNavigate();
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { board_type: 'kanban' },
  });
  const { errors } = form.formState;
  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const project = await create.mutateAsync(values);
      await navigate(`/o/${org}/p/${project.key}`);
    } catch (error) {
      applyServerErrors(error, ['name', 'key'], form.setError);
    }
  });
  const failure =
    create.error && !(create.error instanceof ApiError && [409, 422].includes(create.error.status))
      ? describeError(create.error)
      : null;
  return (
    <section aria-labelledby="new-project-title" className="mx-auto max-w-sm space-y-6">
      <h1 id="new-project-title" className="text-2xl font-semibold">
        Create a project
      </h1>
      <form onSubmit={(e) => void onSubmit(e)} noValidate className="space-y-4">
        <FormError>{failure}</FormError>
        <TextField label="Name" error={errors.name?.message} {...form.register('name')} />
        <TextField
          label="Key"
          hint="Prefix for issue keys, e.g. WEB-1. It cannot be changed later."
          error={errors.key?.message}
          {...form.register('key')}
        />
        <label className="block text-sm">
          Board type
          <select className="ml-2" {...form.register('board_type')}>
            <option value="kanban">Kanban</option>
            <option value="scrum">Scrum</option>
          </select>
        </label>
        <SubmitButton pending={create.isPending}>Create project</SubmitButton>
      </form>
    </section>
  );
}
