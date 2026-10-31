export interface ColumnDraft {
  /** Existing column id; absent for a column added in the editor. */
  id?: string;
  /** Stable React key for drafts that have no id yet. */
  uid: string;
  name: string;
  /** Raw input text so a half-typed value is not lost. */
  wip: string;
  statusIds: string[];
}

export interface ColumnErrors {
  names: Record<string, string>;
  wip: Record<string, string>;
  /** Statuses that are in no column. */
  unmapped: string[];
  form: string | null;
}

export const MAX_COLUMNS = 20;

export function validateColumns(columns: ColumnDraft[], allStatusIds: string[]): ColumnErrors {
  const errors: ColumnErrors = { names: {}, wip: {}, unmapped: [], form: null };
  for (const column of columns) {
    if (column.name.trim() === '') errors.names[column.uid] = 'Enter a column name.';
    else if (column.name.trim().length > 100)
      errors.names[column.uid] = 'Use 100 characters or fewer.';
    const wip = column.wip.trim();
    if (wip !== '' && !(/^\d+$/.test(wip) && Number(wip) >= 1 && Number(wip) <= 1000)) {
      errors.wip[column.uid] = 'Enter a whole number from 1 to 1000, or leave empty.';
    }
  }
  const mapped = new Set(columns.flatMap((c) => c.statusIds));
  errors.unmapped = allStatusIds.filter((id) => !mapped.has(id));
  if (columns.length === 0) errors.form = 'A board needs at least one column.';
  else if (columns.length > MAX_COLUMNS)
    errors.form = `A board can have at most ${MAX_COLUMNS} columns.`;
  else if (errors.unmapped.length > 0) errors.form = 'Every status must be in exactly one column.';
  return errors;
}

export const hasErrors = (e: ColumnErrors) =>
  e.form !== null ||
  e.unmapped.length > 0 ||
  Object.keys(e.names).length > 0 ||
  Object.keys(e.wip).length > 0;

/** Moves a column up (-1) or down (+1); out-of-range is a no-op. */
export function moveColumn(columns: ColumnDraft[], index: number, delta: -1 | 1): ColumnDraft[] {
  const target = index + delta;
  if (target < 0 || target >= columns.length) return columns;
  const next = [...columns];
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item as ColumnDraft);
  return next;
}

/** Puts a status in exactly one column (or in none, with `columnUid` null). */
export function assignStatus(
  columns: ColumnDraft[],
  statusId: string,
  columnUid: string | null,
): ColumnDraft[] {
  return columns.map((c) => {
    const rest = c.statusIds.filter((id) => id !== statusId);
    return { ...c, statusIds: c.uid === columnUid ? [...rest, statusId] : rest };
  });
}

export function toRequest(columns: ColumnDraft[]) {
  return {
    columns: columns.map((c) => ({
      ...(c.id ? { id: c.id } : {}),
      name: c.name.trim(),
      wip_limit: c.wip.trim() === '' ? null : Number(c.wip),
      status_ids: c.statusIds,
    })),
  };
}
