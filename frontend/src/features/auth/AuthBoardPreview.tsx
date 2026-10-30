import { LayoutGrid, List, Settings2 } from 'lucide-react';

import { Avatar } from '../../components/ui/Avatar';

type PreviewCard = {
  key: string;
  title: string;
  tags: { label: string; className: string }[];
  assignee?: string;
};

const COLUMNS: { name: string; cards: PreviewCard[] }[] = [
  {
    name: 'TO DO',
    cards: [
      {
        key: 'WR-12',
        title: 'Design homepage hero',
        tags: [
          { label: 'Design', className: 'bg-[#efe5ff] text-[#53279f]' },
          { label: 'Frontend', className: 'bg-[#dbe7ff] text-[#1d3d8f]' },
        ],
        assignee: 'Sam Lee',
      },
      {
        key: 'WR-14',
        title: 'API spec for checkout',
        tags: [{ label: 'Backend', className: 'bg-[#e0f5e8] text-[#14602f]' }],
        assignee: 'Alex Kim',
      },
    ],
  },
  {
    name: 'IN PROGRESS',
    cards: [
      {
        key: 'WR-9',
        title: 'Set up CI/CD pipeline',
        tags: [{ label: 'DevOps', className: 'bg-[#fde7d6] text-[#8a3a0c]' }],
        assignee: 'Jordan',
      },
    ],
  },
  {
    name: 'DONE',
    cards: [
      {
        key: 'WR-1',
        title: 'Project kickoff',
        tags: [{ label: 'Design', className: 'bg-[#efe5ff] text-[#53279f]' }],
        assignee: 'Sam Lee',
      },
    ],
  },
];

function PreviewCardView({ card }: { card: PreviewCard }) {
  return (
    <article className="rounded-md border border-line/80 bg-surface p-2 shadow-sm">
      <div className="flex items-start justify-between gap-1">
        <p className="text-[9px] font-medium text-fg-subtle">{card.key}</p>
        {card.assignee ? <Avatar name={card.assignee} size="xs" /> : null}
      </div>
      <p className="mt-0.5 text-[10px] font-medium leading-snug text-fg">{card.title}</p>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {card.tags.map((tag) => (
          <span
            key={tag.label}
            className={`rounded px-1 py-0.5 text-[8px] font-semibold uppercase tracking-wide ${tag.className}`}
          >
            {tag.label}
          </span>
        ))}
      </div>
    </article>
  );
}

/** Decorative tilted app preview for auth marketing (not interactive). */
export function AuthBoardPreview() {
  return (
    <div className="relative mx-auto w-full max-w-[480px] pb-8">
      <div className="origin-center rotate-[-2.5deg] transform-gpu">
        <div className="overflow-hidden rounded-xl border border-line/70 bg-surface shadow-[0_28px_56px_rgba(106,69,214,0.22)]">
          <div className="flex items-center gap-1.5 border-b border-line bg-surface-2 px-3 py-1.5">
            <span className="size-2 rounded-full bg-[#ff5f57]" aria-hidden="true" />
            <span className="size-2 rounded-full bg-[#febc2e]" aria-hidden="true" />
            <span className="size-2 rounded-full bg-[#28c840]" aria-hidden="true" />
            <span className="ml-2 text-[10px] font-medium text-fg-muted">Jira Project — Board</span>
          </div>
          <div className="flex min-h-[200px]">
            <nav
              aria-hidden="true"
              className="flex w-11 shrink-0 flex-col items-center gap-3 border-r border-line bg-[#f8f9fc] py-3 dark:bg-surface-2"
            >
              <span className="flex size-7 items-center justify-center rounded-md bg-accent text-accent-fg">
                <LayoutGrid className="size-3.5" />
              </span>
              <List className="size-4 text-fg-subtle" />
              <Settings2 className="size-4 text-fg-subtle" />
            </nav>
            <div className="min-w-0 flex-1 bg-surface">
              <div className="flex gap-4 border-b border-line px-3 pt-2 text-[10px] font-medium text-fg-muted">
                <span className="border-b-2 border-accent pb-1.5 text-accent">Board</span>
                <span className="pb-1.5">Backlog</span>
                <span className="pb-1.5">Issues</span>
              </div>
              <div className="p-3">
                <p className="text-xs font-semibold text-fg">Website Redesign</p>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {COLUMNS.map((col) => (
                    <div key={col.name} className="min-w-0 rounded-md bg-surface-2/80 p-1.5">
                      <div className="mb-1.5 flex items-center justify-between gap-1">
                        <p className="truncate text-[9px] font-semibold uppercase tracking-wide text-fg-subtle">
                          {col.name}
                        </p>
                        <span className="rounded bg-surface px-1 text-[8px] text-fg-muted">
                          {col.cards.length}
                        </span>
                      </div>
                      <div className="space-y-1.5">
                        {col.cards.map((card) => (
                          <PreviewCardView key={card.key} card={card} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <p className="absolute -bottom-3 left-6 z-10 inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-[#6a45d6] to-[#7a57e0] px-3.5 py-2 text-xs font-semibold text-white shadow-lg">
        <span className="flex size-4 items-center justify-center rounded-full bg-white/20 text-[10px]">
          ✓
        </span>
        Ship faster together
      </p>
    </div>
  );
}
