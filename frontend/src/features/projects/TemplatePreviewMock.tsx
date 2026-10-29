import { cn } from '../../lib/cn';

import type { ProjectTemplateId } from './projectTemplates';

function MiniCard({ className }: { className?: string }) {
  return (
    <div
      className={cn('rounded border border-line bg-surface px-2 py-1.5 shadow-sm', className)}
      aria-hidden="true"
    >
      <div className="h-1 w-8 rounded bg-line" />
      <div className="mt-1 h-1 w-full max-w-[4rem] rounded bg-surface-2" />
    </div>
  );
}

function KanbanPreview() {
  const columns = ['To do', 'In progress', 'Done'];
  return (
    <div
      className="flex gap-2 rounded-lg border border-line bg-surface-2 p-3"
      aria-hidden="true"
      role="presentation"
    >
      {columns.map((name, i) => (
        <div key={name} className="min-w-0 flex-1 space-y-1.5">
          <div className="truncate text-[10px] font-semibold uppercase tracking-wide text-fg-muted">
            {name}
          </div>
          <div className="space-y-1 rounded-md border border-dashed border-line bg-surface/80 p-1.5 min-h-[5.5rem]">
            {i < 2 ? <MiniCard /> : null}
            {i === 0 ? <MiniCard className="opacity-70" /> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

function ScrumPreview() {
  return (
    <div className="space-y-2" aria-hidden="true" role="presentation">
      <div className="rounded-lg border border-line bg-surface-2 p-2">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-fg-muted">
          Backlog
        </div>
        <div className="mt-1.5 space-y-1">
          <MiniCard />
          <MiniCard className="opacity-80" />
          <MiniCard className="opacity-60" />
        </div>
      </div>
      <div className="rounded-lg border border-accent/30 bg-accent-soft/30 p-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-accent">
            Sprint 1
          </span>
          <span className="rounded-full bg-surface px-1.5 text-[9px] text-fg-muted">Active</span>
        </div>
        <div className="mt-2 flex gap-1.5">
          {['To do', 'Doing', 'Done'].map((col) => (
            <div key={col} className="flex-1 space-y-1 rounded border border-line/80 bg-surface p-1">
              <div className="text-[9px] text-fg-muted">{col}</div>
              {col === 'To do' ? <MiniCard className="scale-90" /> : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Decorative wireframe shown on the template overview page. */
export function TemplatePreviewMock({ templateId }: { templateId: ProjectTemplateId }) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-wide text-fg-muted">Preview</p>
      {templateId === 'kanban' ? <KanbanPreview /> : <ScrumPreview />}
    </div>
  );
}
