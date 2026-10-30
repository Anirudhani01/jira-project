import type { ProjectSummary } from '../../../lib/api/types';

import { filterOrgProjects } from './filterOrgProjects';

const SAMPLE: ProjectSummary[] = [
  { key: 'SHOP', name: 'Shop', board_type: 'kanban', archived: false, my_role: 'admin' },
  { key: 'MOB', name: 'Mobile', board_type: 'scrum', archived: false, my_role: 'member' },
];

describe('filterOrgProjects', () => {
  it('matches name and key case-insensitively', () => {
    expect(filterOrgProjects(SAMPLE, 'mob').map((p) => p.key)).toEqual(['MOB']);
    expect(filterOrgProjects(SAMPLE, 'shop').map((p) => p.key)).toEqual(['SHOP']);
  });

  it('returns empty for blank query', () => {
    expect(filterOrgProjects(SAMPLE, '  ')).toEqual([]);
  });
});
