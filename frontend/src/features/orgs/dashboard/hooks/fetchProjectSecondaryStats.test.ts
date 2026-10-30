import { sumBoardIssueCount } from './fetchProjectSecondaryStats';

describe('sumBoardIssueCount', () => {
  it('sums column counts', () => {
    expect(
      sumBoardIssueCount({
        project_key: 'WEB',
        board_type: 'kanban',
        truncated: false,
        sprint: null,
        transitions: [],
        columns: [
          {
            id: '1',
            name: 'To Do',
            position: 0,
            wip_limit: null,
            status_ids: [],
            count: 2,
            over_wip_limit: false,
            issues: [],
          },
          {
            id: '2',
            name: 'Done',
            position: 1,
            wip_limit: null,
            status_ids: [],
            count: 5,
            over_wip_limit: false,
            issues: [],
          },
        ],
      }),
    ).toBe(7);
  });
});
