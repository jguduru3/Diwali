import type { Item } from './domain';

/** Customer sort/filter options on a shop page. 'recommended' and 'popular' filter to tagged items; other sorts order all items. No sort = the shop's own order. */
export const ITEM_SORTS = ['recommended', 'popular', 'az', 'priceAsc', 'priceDesc'] as const;
export type ItemSort = (typeof ITEM_SORTS)[number];

export type ItemFilter = {
  categoryId?: string;
  search?: string;
  kiloOnly?: boolean;
  standardOnly?: boolean;
};

type Listed = Pick<
  Item,
  | 'categoryId'
  | 'nameEn'
  | 'nameTe'
  | 'nameHi'
  | 'packDesc'
  | 'effectivePricePaise'
  | 'isRecommended'
  | 'isPopular'
  | 'isStandard'
  | 'saleMode'
>;

export function filterItems<T extends Listed>(list: readonly T[], f: ItemFilter): T[] {
  const needle = f.search?.trim().toLowerCase() ?? '';
  return list.filter(
    (i) =>
      (!f.categoryId || i.categoryId === f.categoryId) &&
      (!f.kiloOnly || i.saleMode === 'kilo') &&
      (!f.standardOnly || i.isStandard) &&
      (!needle ||
        `${i.nameEn} ${i.nameTe ?? ''} ${i.nameHi ?? ''} ${i.packDesc ?? ''}`
          .toLowerCase()
          .includes(needle)),
  );
}

/** Stable sort/filter: 'recommended' and 'popular' filter to tagged items. Other sorts order all items. Ties keep shop order. */
export function sortItems<T extends Listed>(
  list: readonly T[],
  sort: ItemSort | '',
  name: (i: T) => string = (i) => i.nameEn,
): T[] {
  if (sort === 'recommended') {
    return list.filter((i) => i.isRecommended);
  }
  if (sort === 'popular') {
    return list.filter((i) => i.isPopular);
  }
  const cmp: Partial<Record<ItemSort, (a: T, b: T) => number>> = {
    az: (a, b) => name(a).localeCompare(name(b), undefined, { sensitivity: 'base' }),
    priceAsc: (a, b) => a.effectivePricePaise - b.effectivePricePaise,
    priceDesc: (a, b) => b.effectivePricePaise - a.effectivePricePaise,
  };
  return sort && cmp[sort] ? [...list].sort(cmp[sort]) : [...list];
}
