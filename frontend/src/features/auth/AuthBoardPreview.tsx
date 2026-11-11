import { LayoutGrid, List, Settings2 } from 'lucide-react';

import { Avatar } from '../../components/ui/Avatar';

type PreviewCard = { key: string; title: string; label: string; assignee: string };

const COLUMNS: { name: string; dot: string; cards: PreviewCard[] }[] = [
  {
    name: 'To do',
    dot: 'bg-[var(--status-todo)]',
    cards: [
      { key: 'WR-12', title: 'Design homepage hero', label: 'design', assignee: 'Sam Lee' },
      { key: 'WR-14', title: 'API spec for checkout', label: 'backend', assignee: 'Alex Kim' },
    ],
  },
  {
    name: 'In progress',
    dot: 'bg-[var(--status-in-progress)]',
    cards: [{ key: 'WR-9', title: 'Set up CI pipeline', label: 'devops', assignee: 'Jordan Ames' }],
  },
  {
    name: 'Done',
    dot: 'bg-[var(--success)]',
    cards: [{ key: 'WR-1', title: 'Project kickoff', label: 'design', assignee: 'Sam Lee' }],
  },
];

function PreviewCardView({ card }: { card: PreviewCard }) {
  return (
    <article className="rounded-lg border border-line bg-surface p-3 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="rounded border border-line px-1 font-mono text-xs leading-4 text-fg-muted">
          {card.key}
        </span>
        <Avatar name={card.assignee} size="xs" />
      </div>
      <p className="mt-2 text-xs font-medium leading-snug text-fg">{card.title}</p>
      <span className="mt-2 inline-block rounded bg-surface-2 px-2 text-xs leading-4 text-fg-muted">
        {card.label}
      </span>
    </article>
  );
}

/** A straight, quiet preview of this product's board (decorative, not interactive). */
export function AuthBoardPreview() {
  return (
    <div className="mx-auto w-full max-w-[520px] overflow-hidden rounded-xl border border-line bg-surface shadow-md">
      <div className="flex min-h-[240px]">
        <nav
          aria-hidden="true"
          className="flex w-11 shrink-0 flex-col items-center gap-3 border-r border-line bg-surface-2 py-3"
        >
          <span className="flex size-7 items-center justify-center rounded-md bg-accent text-accent-fg">
            <LayoutGrid className="size-4" />
          </span>
          <List className="size-4 text-fg-subtle" />
          <Settings2 className="size-4 text-fg-subtle" />
        </nav>
        <div className="min-w-0 flex-1">
          <div className="flex gap-4 border-b border-line px-3 pt-3 text-xs text-fg-muted">
            <span className="border-b-2 border-accent pb-2 font-medium text-fg">Board</span>
            <span className="pb-2">Backlog</span>
            <span className="pb-2">Issues</span>
          </div>
          <div className="p-3">
            <p className="text-sm font-medium text-fg">Website redesign</p>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {COLUMNS.map((column) => (
                <div key={column.name} className="min-w-0 rounded-lg bg-surface-2 p-2">
                  <p className="mb-2 flex items-center gap-2 text-xs font-medium text-fg-muted">
                    <span className={`size-2 shrink-0 rounded-full ${column.dot}`} />
                    <span className="truncate">{column.name}</span>
                  </p>
                  <div className="space-y-2">
                    {column.cards.map((card) => (
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
  );
}
