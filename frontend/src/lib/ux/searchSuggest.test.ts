import { describe, expect, it } from 'vitest';

import { suggestProjectQuery, type ProjectSuggestInput } from './searchSuggest';

const CORPUS: ProjectSuggestInput[] = [
  { key: 'WEB', name: 'Website Redesign' },
  { key: 'MOB', name: 'Mobile App' },
  { key: 'ACME', name: 'Acme Mobile App' },
];

describe('suggestProjectQuery', () => {
  it('returns null below minimum query length', () => {
    expect(suggestProjectQuery('we', CORPUS)).toBeNull();
    expect(suggestProjectQuery('  ', CORPUS)).toBeNull();
  });

  it('suggests obvious typos within edit distance', () => {
    expect(suggestProjectQuery('webb', CORPUS)).toEqual({
      label: 'WEB',
      applyValue: 'WEB',
    });
    expect(suggestProjectQuery('mobx', CORPUS)).toEqual({
      label: 'MOB',
      applyValue: 'MOB',
    });
  });

  it('rejects unrelated strings', () => {
    expect(suggestProjectQuery('finance', CORPUS)).toBeNull();
    expect(suggestProjectQuery('xyz', CORPUS)).toBeNull();
  });

  it('rejects ties between equally good candidates', () => {
    const tied = [
      { key: 'AAA', name: 'Alpha One' },
      { key: 'AAB', name: 'Alpha Two' },
    ];
    expect(suggestProjectQuery('alfa', tied)).toBeNull();
  });

  it('requires shared prefix of at least two characters', () => {
    expect(suggestProjectQuery('eb', [{ key: 'WEB', name: 'Website' }])).toBeNull();
  });

  it('allows edit distance 2 only for queries of at least 6 characters', () => {
    expect(suggestProjectQuery('webste', [{ key: 'WEB', name: 'Website' }])).toEqual({
      label: 'Website',
      applyValue: 'Website',
    });
    expect(suggestProjectQuery('xyzzq', [{ key: 'WEB', name: 'Website' }])).toBeNull();
  });

  it('prefers project-key similarity over name similarity', () => {
    const projects = [{ key: 'MOB', name: 'Mobile Application' }];
    expect(suggestProjectQuery('mobz', projects)).toEqual({
      label: 'MOB',
      applyValue: 'MOB',
    });
  });
});
