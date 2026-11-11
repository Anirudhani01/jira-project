/** Catalog entries selectable when creating issues or changing type/priority on an issue. */
export function selectableCatalogEntries<T extends { id: string; is_active: boolean }>(
  items: T[],
  currentId?: string | null,
): T[] {
  return items.filter((item) => item.is_active || item.id === currentId);
}

export function activeCatalogEntries<T extends { is_active: boolean }>(items: T[]): T[] {
  return items.filter((item) => item.is_active);
}
