/** Every keyboard shortcut in one place: the help dialog and the command palette read it, so
 * what is documented is what is bound. Keys follow the reference product's documented set. */
export interface ShortcutDef {
  id: string;
  keys: string[];
  description: string;
  group: 'Global' | 'Go to' | 'Lists' | 'Issue' | 'Backlog';
}

export const SHORTCUTS: readonly ShortcutDef[] = [
  { id: 'help', keys: ['?'], description: 'Show keyboard shortcuts', group: 'Global' },
  {
    id: 'palette',
    keys: ['Ctrl/⌘', 'K'],
    description: 'Open the command palette',
    group: 'Global',
  },
  { id: 'create', keys: ['C'], description: 'Create an issue', group: 'Global' },
  { id: 'search', keys: ['/'], description: 'Focus the search box', group: 'Global' },
  {
    id: 'sidebar',
    keys: ['Ctrl', '['],
    description: 'Collapse or expand the sidebar',
    group: 'Global',
  },
  { id: 'go-home', keys: ['G', 'H'], description: 'Go to For you', group: 'Go to' },
  { id: 'go-board', keys: ['G', 'B'], description: 'Go to the board', group: 'Go to' },
  { id: 'go-backlog', keys: ['G', 'L'], description: 'Go to the backlog', group: 'Go to' },
  { id: 'go-issues', keys: ['G', 'I'], description: 'Go to the issue list', group: 'Go to' },
  { id: 'next', keys: ['J'], description: 'Move to the next issue', group: 'Lists' },
  { id: 'previous', keys: ['K'], description: 'Move to the previous issue', group: 'Lists' },
  { id: 'open', keys: ['O'], description: 'Open the selected issue', group: 'Lists' },
  { id: 'comment', keys: ['M'], description: 'Add a comment (on an issue)', group: 'Issue' },
  { id: 'epics', keys: ['E'], description: 'Show or hide the Epics panel', group: 'Backlog' },
  { id: 'versions', keys: ['V'], description: 'Show or hide the Versions panel', group: 'Backlog' },
];

export const GROUPS: ShortcutDef['group'][] = ['Global', 'Go to', 'Lists', 'Issue', 'Backlog'];

/** "G then B" style label for a shortcut's keys. */
export function keysLabel(keys: readonly string[]): string {
  return keys.length === 2 && keys[0] === 'G' ? `${keys[0]} then ${keys[1]}` : keys.join(' + ');
}
