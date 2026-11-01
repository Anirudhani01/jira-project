import { moveColumn } from './boardColumnsModel';
import {
  applyStatusRemapToDraft,
  cloneDraft,
  columnSignature,
  fromServer,
  isDirty,
  removeStatusFromDraft,
  toReplaceWorkflowRequest,
  type WorkflowDraft,
} from './workflowEditorModel';

const S1 = '44444444-4444-4444-4444-444444444441';
const S2 = '44444444-4444-4444-4444-444444444442';
const C1 = '55555555-5555-5555-5555-555555555551';
const C2 = '55555555-5555-5555-5555-555555555552';

const workflow = {
  name: 'Default',
  revision: 1,
  initial_status_id: S1,
  statuses: [
    { id: S1, name: 'To Do', category: 'todo' as const, position: 0 },
    { id: S2, name: 'Done', category: 'done' as const, position: 1 },
  ],
  transitions: [],
  columns: [
    { name: 'To Do', position: 0, status_ids: [S1] },
    { name: 'Done', position: 1, status_ids: [S2] },
  ],
};

const board = {
  project_key: 'WEB',
  board_type: 'kanban' as const,
  truncated: false,
  sprint: null,
  transitions: [],
  columns: [
    {
      id: C1,
      name: 'To Do',
      position: 0,
      wip_limit: null,
      status_ids: [S1],
      count: 0,
      over_wip_limit: false,
      issues: [],
    },
    {
      id: C2,
      name: 'Done',
      position: 1,
      wip_limit: 3,
      status_ids: [S2],
      count: 0,
      over_wip_limit: false,
      issues: [],
    },
  ],
};

describe('columnSignature', () => {
  it('sorts ids for stable matching', () => {
    expect(columnSignature([S2, S1])).toBe(columnSignature([S1, S2]));
    expect(columnSignature([])).toBe('');
  });
});

describe('fromServer', () => {
  it('merges board ids and WIP by status_ids signature', () => {
    const result = fromServer(workflow, board);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.columns.map((c) => c.id)).toEqual([C1, C2]);
    expect(result.draft.columns[1]?.wip).toBe('3');
  });

  it('rejects duplicate workflow column signatures', () => {
    const dupWorkflow = {
      ...workflow,
      columns: [
        { name: 'Col A', position: 0, status_ids: [S1] },
        { name: 'Col B', position: 1, status_ids: [S1] },
      ],
    };
    const result = fromServer(dupWorkflow, board);
    expect(result.ok).toBe(false);
  });

  it('rejects duplicate empty workflow column signatures', () => {
    const dupEmptyWorkflow = {
      ...workflow,
      columns: [
        ...workflow.columns,
        { name: 'Empty A', position: 2, status_ids: [] as string[] },
        { name: 'Empty B', position: 3, status_ids: [] as string[] },
      ],
    };
    const result = fromServer(dupEmptyWorkflow, board);
    expect(result.ok).toBe(false);
  });

  it('assigns distinct client keys to workflow-only empty columns at different positions', () => {
    const wfOnly = {
      ...workflow,
      columns: [
        ...workflow.columns,
        { name: 'Empty A', position: 2, status_ids: [] as string[] },
      ],
    };
    const result = fromServer(wfOnly, board);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const uids = result.draft.columns.map((c) => c.uid);
    expect(new Set(uids).size).toBe(uids.length);
    const extra = result.draft.columns.find((c) => c.name === 'Empty A');
    expect(extra?.uid).toBe('wf:empty:Empty A:2');
  });

  it('does not cross-assign board column ids or WIP across signatures', () => {
    const S3 = '44444444-4444-4444-4444-444444444443';
    const C3 = '55555555-5555-5555-5555-555555555553';
    const multiWorkflow = {
      ...workflow,
      statuses: [
        ...workflow.statuses,
        { id: S3, name: 'Review', category: 'in_progress' as const, position: 2 },
      ],
      columns: [
        { name: 'To Do', position: 0, status_ids: [S1] },
        { name: 'Review', position: 1, status_ids: [S3] },
        { name: 'Done', position: 2, status_ids: [S2] },
      ],
    };
    const boardTodo = board.columns[0];
    const boardDone = board.columns[1];
    if (!boardTodo || !boardDone) throw new Error('missing column fixture');
    const multiBoard = {
      ...board,
      columns: [
        boardTodo,
        {
          id: C3,
          name: 'Review',
          position: 1,
          wip_limit: 7,
          status_ids: [S3],
          count: 0,
          over_wip_limit: false,
          issues: [],
        },
        { ...boardDone, position: 2 },
      ],
    };
    const result = fromServer(multiWorkflow, multiBoard);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const review = result.draft.columns.find((c) => c.name === 'Review');
    expect(review?.id).toBe(C3);
    expect(review?.wip).toBe('7');
    const done = result.draft.columns.find((c) => c.name === 'Done');
    expect(done?.id).toBe(C2);
    expect(done?.wip).toBe('3');
  });

  it('rejects duplicate board column signatures', () => {
    const firstCol = board.columns[0];
    if (!firstCol) throw new Error('missing column fixture');
    const dupBoard = {
      ...board,
      columns: [
        { ...firstCol, id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', status_ids: [S1] },
        {
          ...firstCol,
          id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
          position: 1,
          status_ids: [S1],
        },
      ],
    };
    const result = fromServer(workflow, dupBoard);
    expect(result.ok).toBe(false);
  });

  it('appends workflow-only columns without server ids', () => {
    const wfOnly = {
      ...workflow,
      columns: [
        ...workflow.columns,
        { name: 'Extra', position: 2, status_ids: [] as string[] },
      ],
    };
    const result = fromServer(wfOnly, board);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const extra = result.draft.columns.find((c) => c.name === 'Extra');
    expect(extra?.id).toBeUndefined();
  });
});

describe('toReplaceWorkflowRequest', () => {
  it('preserves column ids after reorder and includes wip_limit', () => {
    const boot = fromServer(workflow, board);
    expect(boot.ok).toBe(true);
    if (!boot.ok) return;
    const reordered: WorkflowDraft = {
      ...boot.draft,
      columns: moveColumn(boot.draft.columns, 1, -1),
    };
    const body = toReplaceWorkflowRequest(reordered);
    expect(body.columns[0]?.id).toBe(C2);
    expect(body.columns[1]?.id).toBe(C1);
    expect(body.columns[0]?.wip_limit).toBe(3);
  });

  it('omits id for newly created columns', () => {
    const boot = fromServer(workflow, board);
    expect(boot.ok).toBe(true);
    if (!boot.ok) return;
    const withNew: WorkflowDraft = {
      ...boot.draft,
      columns: [
        ...boot.draft.columns,
        { uid: 'new-col', name: 'New', wip: '5', statusIds: [] },
      ],
    };
    const body = toReplaceWorkflowRequest(withNew);
    const created = body.columns.find((c) => c.name === 'New');
    expect(created).toEqual({ name: 'New', wip_limit: 5, status_ids: [] });
    expect('id' in (created ?? {})).toBe(false);
  });

  it('includes status_remaps after status removal', () => {
    const boot = fromServer(workflow, board);
    expect(boot.ok).toBe(true);
    if (!boot.ok) return;
    let draft = removeStatusFromDraft(boot.draft, S2);
    draft = {
      ...draft,
      statusRemaps: [{ from_status_id: S2, to_status_id: S1 }],
    };
    const body = toReplaceWorkflowRequest(draft);
    expect(body.status_remaps).toEqual([{ from_status_id: S2, to_status_id: S1 }]);
    expect(body.statuses.some((s) => s.id === S2)).toBe(false);
  });
});

describe('isDirty', () => {
  it('detects workflow name changes', () => {
    const boot = fromServer(workflow, board);
    expect(boot.ok).toBe(true);
    if (!boot.ok) return;
    const changed = { ...boot.draft, name: 'Other' };
    expect(isDirty(changed, boot.draft)).toBe(true);
  });

  it('is clean when fromServer is applied twice with the same inputs', () => {
    const first = fromServer(workflow, board);
    const second = fromServer(workflow, board);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(isDirty(first.draft, second.draft)).toBe(false);
  });

  it('is dirty after status removal and after status_in_use remap', () => {
    const boot = fromServer(workflow, board);
    expect(boot.ok).toBe(true);
    if (!boot.ok) return;
    const baseline = cloneDraft(boot.draft);
    const deleted = removeStatusFromDraft(boot.draft, S2);
    expect(isDirty(deleted, baseline)).toBe(true);
    const remapped = applyStatusRemapToDraft(deleted, S2, S1);
    expect(isDirty(remapped, baseline)).toBe(true);
    expect(remapped.statusRemaps).toEqual([{ from_status_id: S2, to_status_id: S1 }]);
  });
});

/** A4a-shaped workflow/board (board carries extra status on first column). */
const A4A_STATUS_TODO = S1;
const A4A_STATUS_PROGRESS = '44444444-4444-4444-4444-444444444443';
const A4A_STATUS_DONE = '44444444-4444-4444-4444-444444444442';

const a4aWorkflow = {
  name: 'Default workflow',
  revision: 1,
  initial_status_id: A4A_STATUS_TODO,
  statuses: [
    { id: A4A_STATUS_TODO, name: 'To Do', category: 'todo' as const, position: 0 },
    { id: A4A_STATUS_PROGRESS, name: 'In Progress', category: 'in_progress' as const, position: 1 },
    { id: A4A_STATUS_DONE, name: 'Done', category: 'done' as const, position: 2 },
  ],
  transitions: [],
  columns: [
    { name: 'To Do', position: 0, status_ids: [A4A_STATUS_TODO] },
    { name: 'Done', position: 1, status_ids: [A4A_STATUS_DONE] },
  ],
};

const a4aBoard = {
  project_key: 'WEB',
  board_type: 'kanban' as const,
  truncated: false,
  sprint: null,
  transitions: [],
  columns: [
    {
      id: C1,
      name: 'To Do',
      position: 0,
      wip_limit: null,
      status_ids: [A4A_STATUS_TODO, A4A_STATUS_PROGRESS],
      count: 0,
      over_wip_limit: false,
      issues: [],
    },
    {
      id: C2,
      name: 'Done',
      position: 1,
      wip_limit: 3,
      status_ids: [A4A_STATUS_DONE],
      count: 0,
      over_wip_limit: false,
      issues: [],
    },
  ],
};

describe('isDirty (A4a fixtures)', () => {
  it('starts clean for mismatched workflow/board column signatures', () => {
    const a = fromServer(a4aWorkflow, a4aBoard);
    const b = fromServer(a4aWorkflow, a4aBoard);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(isDirty(a.draft, b.draft)).toBe(false);
  });
});
