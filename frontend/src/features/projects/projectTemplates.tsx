import { Kanban, LayoutGrid, type LucideIcon } from 'lucide-react';

export type ProjectTemplateId = 'kanban' | 'scrum';

export type ProjectTemplate = {
  id: ProjectTemplateId;
  label: string;
  title: string;
  description: string;
  summary: string;
  icon: LucideIcon;
  includes: string[];
};

export const PROJECT_TEMPLATES: Record<ProjectTemplateId, ProjectTemplate> = {
  kanban: {
    id: 'kanban',
    label: 'Kanban template',
    title: 'Kanban',
    description: 'Continuous flow on a board with columns.',
    summary: 'Track work as cards moving through columns — ideal for support queues and ops teams.',
    icon: Kanban,
    includes: ['Board with customizable columns', 'Workflow and statuses you control', 'Issue list and detail views'],
  },
  scrum: {
    id: 'scrum',
    label: 'Scrum template',
    title: 'Scrum',
    description: 'Sprints, backlog, and board together.',
    summary: 'Plan in sprints, groom a backlog, and run a board for the active sprint.',
    icon: LayoutGrid,
    includes: ['Backlog and sprint planning', 'Board for the active sprint', 'Start and complete sprint flows'],
  },
};

export function parseProjectTemplate(value: string | null): ProjectTemplateId | null {
  if (value === 'kanban' || value === 'scrum') return value;
  return null;
}
