import { Link } from 'react-router';

import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';

import { PROJECT_TEMPLATES, type ProjectTemplateId } from './projectTemplates';
import { TemplatePreviewMock } from './TemplatePreviewMock';

/** Read-only template overview — no project name/key on this screen. */
export function ProjectTemplateView({
  org,
  templateId,
}: {
  org: string;
  templateId: ProjectTemplateId;
}) {
  const template = PROJECT_TEMPLATES[templateId];
  const Icon = template.icon;
  const createHref = `/o/${org}/projects/new?board_type=${templateId}&step=create`;

  return (
    <section aria-labelledby="template-title" className="mx-auto max-w-4xl">
      <Card className="overflow-hidden border-line-strong shadow-md">
        <div className="border-b border-line bg-accent-soft/50 px-6 py-4 sm:px-8">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="accent">Template overview</Badge>
            <Badge tone="neutral">{template.title}</Badge>
          </div>
          <div className="mt-4 flex items-start gap-4">
            <div className="flex size-16 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-fg shadow-sm">
              <Icon className="size-9" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h1 id="template-title" className="text-2xl font-semibold text-fg sm:text-3xl">
                {template.label}
              </h1>
              <p className="mt-1 text-base text-fg-muted">{template.description}</p>
            </div>
          </div>
        </div>

        <div className="grid gap-8 px-6 py-8 sm:px-8 lg:grid-cols-2 lg:items-start">
          <div className="space-y-6">
            <div>
              <h2 className="text-sm font-semibold text-fg">About this template</h2>
              <p className="mt-2 text-sm leading-relaxed text-fg-muted">{template.summary}</p>
            </div>
            <div>
              <h2 className="text-sm font-semibold text-fg">What you get</h2>
              <ul className="mt-3 space-y-2">
                {template.includes.map((item) => (
                  <li
                    key={item}
                    className="flex gap-3 rounded-md border border-line bg-surface-2/80 px-3 py-2 text-sm text-fg"
                  >
                    <span className="mt-0.5 size-1.5 shrink-0 rounded-full bg-accent" aria-hidden="true" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="rounded-xl border border-line bg-bg p-4 lg:sticky lg:top-6">
            <TemplatePreviewMock templateId={templateId} />
            <p className="mt-3 text-xs text-fg-muted">
              Illustration only — your columns, statuses, and workflow are configured after you
              create the project.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-surface-2/50 px-6 py-4 sm:px-8">
          <Button variant="secondary" asChild>
            <Link to={`/o/${org}/projects/new`}>All templates</Link>
          </Button>
          <Button variant="primary" size="lg" asChild>
            <Link to={createHref}>Use this template</Link>
          </Button>
        </div>
      </Card>
    </section>
  );
}
