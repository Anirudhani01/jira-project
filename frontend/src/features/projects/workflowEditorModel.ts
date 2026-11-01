import type { Board, BoardColumn, Workflow } from '../../lib/api/types';
import type { ReplaceWorkflowRequest } from '../../lib/api/types';

import {
  hasErrors,
  validateColumns,
  type ColumnDraft,
  type ColumnErrors,
} from './boardColumnsModel';

export type StatusCategory = 'todo' | 'in_progress' | 'done';

export interface StatusDraft {
  clientKey: string;
  id: string;
  name: string;
  category: StatusCategory;
}

export interface TransitionDraft {
  clientKey: string;
  id: string;
  name: string;
  from_status_id: string | null;
  to_status_id: string;
}

export interface StatusRemapDraft {
  from_status_id: string;
  to_status_id: string;
}

export interface WorkflowDraft {
  name: string;
  initialStatusId: string;
  statuses: StatusDraft[];
  transitions: TransitionDraft[];
  columns: ColumnDraft[];
  statusRemaps: StatusRemapDraft[];
  /** Server ids removed from graph but kept for remap UI */
  removedStatusIds: string[];
}

export interface WorkflowEditorErrors {
  form: string | null;
  workflowName: string | null;
  initialStatus: string | null;
  statusNames: Record<string, string>;
  transitionNames: Record<string, string>;
  columns: ColumnErrors;
  loadError: string | null;
}

let columnUidCounter = 0;
export const nextColumnClientKey = () => `col-new-${String((columnUidCounter += 1))}`;

let statusUidCounter = 0;
export const nextStatusClientKey = () => `st-new-${String((statusUidCounter += 1))}`;

let transitionUidCounter = 0;
export const nextTransitionClientKey = () => `tr-new-${String((transitionUidCounter += 1))}`;

/** Stable set key for column ↔ workflow matching (not array index). */
export function columnSignature(statusIds: string[]): string {
  if (statusIds.length === 0) return '';
  return [...statusIds].sort().join('\0');
}

function boardColumnToDraft(column: BoardColumn, clientKey: string, statusIds: string[]): ColumnDraft {
  return {
    id: column.id,
    uid: clientKey,
    name: column.name,
    wip: column.wip_limit === null ? '' : String(column.wip_limit),
    statusIds: [...statusIds],
  };
}

function indexBySignature<T extends { status_ids: string[] }>(
  items: T[],
): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const sig = columnSignature(item.status_ids);
    const list = map.get(sig) ?? [];
    list.push(item);
    map.set(sig, list);
  }
  return map;
}

function uniqueSignatureMatch<T>(groups: T[] | undefined): T | undefined {
  if (!groups || groups.length !== 1) return undefined;
  return groups[0];
}

export type FromServerResult =
  | { ok: true; draft: WorkflowDraft }
  | { ok: false; error: string };

export function fromServer(workflow: Workflow, board: Board): FromServerResult {
  const wfBySig = indexBySignature(workflow.columns);
  const boardBySig = indexBySignature(board.columns);

  for (const [, cols] of boardBySig) {
    if (cols.length > 1) {
      return {
        ok: false,
        error:
          'Board columns have duplicate status mappings. Fix the board configuration before editing the workflow.',
      };
    }
  }
  for (const [, cols] of wfBySig) {
    if (cols.length > 1) {
      return {
        ok: false,
        error: 'Workflow column mapping is ambiguous. Reload and try again.',
      };
    }
  }

  const columns: ColumnDraft[] = [];
  const sortedBoard = [...board.columns].sort((a, b) => a.position - b.position);

  for (const boardCol of sortedBoard) {
    const sig = columnSignature(boardCol.status_ids);
    const wfMatch = uniqueSignatureMatch(wfBySig.get(sig));
    const statusIds = wfMatch ? [...wfMatch.status_ids] : [...boardCol.status_ids];
    columns.push(boardColumnToDraft(boardCol, boardCol.id, statusIds));
  }

  const matchedBoardSigs = new Set(
    sortedBoard.map((c) => columnSignature(c.status_ids)),
  );

  const sortedWf = [...workflow.columns].sort((a, b) => a.position - b.position);
  for (const wfCol of sortedWf) {
    const sig = columnSignature(wfCol.status_ids);
    if (matchedBoardSigs.has(sig)) continue;
    if (sig === '' && sortedBoard.some((b) => columnSignature(b.status_ids) === '')) {
      continue;
    }
    columns.push({
      uid: sig ? `wf:${sig}` : `wf:empty:${wfCol.name}:${String(wfCol.position)}`,
      name: wfCol.name,
      wip: '',
      statusIds: [...wfCol.status_ids],
    });
  }

  const statuses: StatusDraft[] = [...workflow.statuses]
    .sort((a, b) => a.position - b.position)
    .map((s) => ({
      clientKey: s.id,
      id: s.id,
      name: s.name,
      category: s.category as StatusCategory,
    }));

  const transitions: TransitionDraft[] = workflow.transitions.map((t) => ({
    clientKey: t.id,
    id: t.id,
    name: t.name,
    from_status_id: t.from_status_id,
    to_status_id: t.to_status_id,
  }));

  return {
    ok: true,
    draft: {
      name: workflow.name,
      initialStatusId: workflow.initial_status_id,
      statuses,
      transitions,
      columns,
      statusRemaps: [],
      removedStatusIds: [],
    },
  };
}

export function cloneDraft(draft: WorkflowDraft): WorkflowDraft {
  return JSON.parse(JSON.stringify(draft)) as WorkflowDraft;
}

export function normalizeForCompare(draft: WorkflowDraft): unknown {
  return {
    name: draft.name.trim(),
    initialStatusId: draft.initialStatusId,
    statuses: draft.statuses.map((s, i) => ({
      id: s.id,
      name: s.name.trim(),
      category: s.category,
      position: i,
    })),
    transitions: draft.transitions.map((t) => ({
      id: t.id,
      name: t.name.trim(),
      from: t.from_status_id,
      to: t.to_status_id,
    })),
    columns: draft.columns.map((c, position) => ({
      id: c.id,
      position,
      name: c.name.trim(),
      wip: c.wip.trim(),
      statusIds: [...c.statusIds].sort(),
    })),
    remaps: [...draft.statusRemaps].sort((a, b) =>
      a.from_status_id.localeCompare(b.from_status_id),
    ),
    removed: [...draft.removedStatusIds].sort(),
  };
}

export function isDirty(a: WorkflowDraft, b: WorkflowDraft): boolean {
  return JSON.stringify(normalizeForCompare(a)) !== JSON.stringify(normalizeForCompare(b));
}

export function validateDraft(draft: WorkflowDraft): WorkflowEditorErrors {
  const statusNames: Record<string, string> = {};
  const seen = new Set<string>();
  for (const s of draft.statuses) {
    const key = s.name.trim().toLowerCase();
    if (s.name.trim() === '') statusNames[s.clientKey] = 'Enter a status name.';
    else if (key && seen.has(key)) statusNames[s.clientKey] = 'Name is already used in this workflow.';
    else if (key) seen.add(key);
  }

  let workflowName: string | null = null;
  if (draft.name.trim() === '') workflowName = 'Enter a workflow name.';

  let initialStatus: string | null = null;
  if (!draft.statuses.some((s) => s.id === draft.initialStatusId)) {
    initialStatus = 'Choose an initial status from the statuses below.';
  }

  const transitionNames: Record<string, string> = {};
  const statusIds = new Set(draft.statuses.map((s) => s.id));
  for (const t of draft.transitions) {
    if (t.name.trim() === '') transitionNames[t.clientKey] = 'Enter a transition name.';
    if (!statusIds.has(t.to_status_id)) {
      transitionNames[t.clientKey] = 'Target status is not in this workflow.';
    }
    if (t.from_status_id && !statusIds.has(t.from_status_id)) {
      transitionNames[t.clientKey] = 'Source status is not in this workflow.';
    }
  }

  const columns = validateColumns(
    draft.columns,
    draft.statuses.map((s) => s.id),
  );

  let form: string | null = columns.form;
  if (draft.statuses.length === 0) form = 'A workflow needs at least one status.';

  return {
    form,
    workflowName,
    initialStatus,
    statusNames,
    transitionNames,
    columns,
    loadError: null,
  };
}

export function editorHasErrors(errors: WorkflowEditorErrors): boolean {
  return (
    errors.form !== null ||
    errors.workflowName !== null ||
    errors.initialStatus !== null ||
    Object.keys(errors.statusNames).length > 0 ||
    Object.keys(errors.transitionNames).length > 0 ||
    hasErrors(errors.columns)
  );
}

export function toReplaceWorkflowRequest(draft: WorkflowDraft): ReplaceWorkflowRequest {
  return {
    name: draft.name.trim(),
    initial_status_id: draft.initialStatusId,
    statuses: draft.statuses.map((s, position) => ({
      id: s.id,
      name: s.name.trim(),
      category: s.category,
      position,
    })),
    transitions: draft.transitions.map((t) => ({
      id: t.id,
      name: t.name.trim(),
      from_status_id: t.from_status_id,
      to_status_id: t.to_status_id,
    })),
    columns: draft.columns.map((c) => ({
      ...(c.id ? { id: c.id } : {}),
      name: c.name.trim(),
      wip_limit: c.wip.trim() === '' ? null : Number(c.wip),
      status_ids: c.statusIds,
    })),
    status_remaps: draft.statusRemaps.map((r) => ({
      from_status_id: r.from_status_id,
      to_status_id: r.to_status_id,
    })),
  };
}

export function applyStatusRemapToDraft(
  draft: WorkflowDraft,
  fromId: string,
  toId: string,
): WorkflowDraft {
  const next = cloneDraft(draft);
  const remapIdx = next.statusRemaps.findIndex((r) => r.from_status_id === fromId);
  if (remapIdx >= 0) next.statusRemaps[remapIdx] = { from_status_id: fromId, to_status_id: toId };
  else next.statusRemaps.push({ from_status_id: fromId, to_status_id: toId });
  return next;
}

export function removeStatusFromDraft(draft: WorkflowDraft, statusId: string): WorkflowDraft {
  const next = cloneDraft(draft);
  if (!next.removedStatusIds.includes(statusId)) next.removedStatusIds.push(statusId);
  next.statuses = next.statuses.filter((s) => s.id !== statusId);
  next.transitions = next.transitions.filter(
    (t) => t.from_status_id !== statusId && t.to_status_id !== statusId,
  );
  next.columns = next.columns.map((c) => ({
    ...c,
    statusIds: c.statusIds.filter((id) => id !== statusId),
  }));
  if (next.initialStatusId === statusId) {
    next.initialStatusId = next.statuses[0]?.id ?? '';
  }
  next.statusRemaps = next.statusRemaps.filter((r) => r.from_status_id !== statusId);
  return next;
}

export function addStatus(draft: WorkflowDraft): WorkflowDraft {
  const next = cloneDraft(draft);
  const id = crypto.randomUUID();
  next.statuses.push({
    clientKey: nextStatusClientKey(),
    id,
    name: '',
    category: 'todo',
  });
  return next;
}

export function addTransition(draft: WorkflowDraft): WorkflowDraft {
  const next = cloneDraft(draft);
  next.transitions.push({
    clientKey: nextTransitionClientKey(),
    id: crypto.randomUUID(),
    name: '',
    from_status_id: null,
    to_status_id: next.statuses[0]?.id ?? '',
  });
  return next;
}
