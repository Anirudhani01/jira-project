import { describe, expect, it } from 'vitest';

import { activeCatalogEntries, selectableCatalogEntries } from './catalogUtils';

describe('catalogUtils', () => {
  const items = [
    { id: 'a', is_active: true },
    { id: 'b', is_active: false },
    { id: 'c', is_active: true },
  ];

  it('activeCatalogEntries keeps only active rows', () => {
    expect(activeCatalogEntries(items).map((i) => i.id)).toEqual(['a', 'c']);
  });

  it('selectableCatalogEntries includes the current value when inactive', () => {
    expect(selectableCatalogEntries(items, 'b').map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });
});
