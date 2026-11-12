import { json, mockApi } from '../../../../test/api';

import { fetchProjectMemberCount } from './fetchProjectMemberCount';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchProjectMemberCount', () => {
  it('counts the members of the project', async () => {
    const calls = mockApi({
      'GET /orgs/acme/projects/WEB/members': () =>
        json({ items: [{ user_id: 'a' }, { user_id: 'b' }, { user_id: 'c' }] }),
    });
    await expect(fetchProjectMemberCount('acme', 'WEB')).resolves.toBe(3);
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'GET /orgs/acme/projects/WEB/members',
    ]);
  });
});
