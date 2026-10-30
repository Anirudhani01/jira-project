import type { ProjectSummary } from '../../../lib/api/types';

import { applyProjectDashboardFilters } from './projectDashboardFilters';

const SAMPLE: ProjectSummary[] = [
  {
    key: 'MOB',
    name: 'Mobile',
    board_type: 'scrum',
    archived: false,
    my_role: 'admin',
  },
  {
    key: 'SHOP',
    name: 'Shop',
    board_type: 'kanban',
    archived: false,
    my_role: 'member',
  },
];

describe('applyProjectDashboardFilters', () => {
  it('filters by search query and board type', () => {
    const result = applyProjectDashboardFilters(SAMPLE, {
      q: 'shop',
      boardType: 'kanban',
      status: 'active',
      sort: 'name-asc',
      view: 'grid',
    });
    expect(result.map((p) => p.key)).toEqual(['SHOP']);
  });

  it('excludes archived projects when status is active', () => {
    const mobile = SAMPLE.find((p) => p.key === 'MOB');
    const shop = SAMPLE.find((p) => p.key === 'SHOP');
    if (!mobile || !shop) throw new Error('fixture');
    const items: ProjectSummary[] = [{ ...mobile, archived: true }, shop];
    const result = applyProjectDashboardFilters(items, {
      q: '',
      boardType: 'all',
      status: 'active',
      sort: 'key-asc',
      view: 'grid',
    });
    expect(result.map((p) => p.key)).toEqual(['SHOP']);
  });
});
