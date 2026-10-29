import { Link } from 'react-router';

import { Card } from '../../components/ui/Card';

import { PROJECT_TEMPLATES, type ProjectTemplateId } from './projectTemplates';

export function ProjectTemplatePicker({ org }: { org: string }) {
  const templates = Object.values(PROJECT_TEMPLATES) as (typeof PROJECT_TEMPLATES)[ProjectTemplateId][];

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {templates.map((template) => {
        const Icon = template.icon;
        return (
          <Link
            key={template.id}
            to={`/o/${org}/projects/new?board_type=${template.id}`}
            className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            aria-label={`View ${template.label}`}
          >
            <Card className="flex h-full gap-3 p-4 transition-colors hover:border-line-strong hover:bg-surface-hover">
              <Icon className="size-8 shrink-0 text-accent" aria-hidden="true" />
              <div>
                <p className="font-medium text-fg">{template.label}</p>
                <p className="text-sm text-fg-muted">{template.description}</p>
              </div>
            </Card>
          </Link>
        );
      })}
    </div>
  );
}
