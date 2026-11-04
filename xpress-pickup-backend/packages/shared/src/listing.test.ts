import { describe, expect, it } from 'vitest';
import { filterItems, sortItems } from './listing';

type Over = {
  categoryId?: string;
  nameEn?: string;
  nameTe?: string | null;
  nameHi?: string | null;
  effectivePricePaise?: number;
  isRecommended?: boolean;
  isPopular?: boolean;
  isStandard?: boolean;
  weightGrams?: number | null;
};

const item = (no: number, over: Over = {}) => ({
  no,
  categoryId: 'c1',
  nameEn: `Item ${no}`,
  nameTe: null as string | null,
  nameHi: null as string | null,
  packDesc: '10 pcs',
  effectivePricePaise: no * 1000,
  isRecommended: false,
  isPopular: false,
  isStandard: false,
  weightGrams: null as number | null,
  ...over,
  saleMode: (over.weightGrams != null ? 'kilo' : 'mrp') as 'kilo' | 'mrp',
});

const nos = (list: { no: number }[]) => list.map((i) => i.no);

describe('sortItems', () => {
  const list = [
    item(1, { nameEn: 'rocket', effectivePricePaise: 5000 }),
    item(2, { nameEn: 'Anar', effectivePricePaise: 2000, isPopular: true }),
    item(3, { nameEn: 'Bijili', effectivePricePaise: 9000, isRecommended: true }),
    item(4, { nameEn: 'chakkar', effectivePricePaise: 2000, isPopular: true }),
  ];

  it("keeps the shop's order when no sort is chosen", () => {
    expect(nos(sortItems(list, ''))).toEqual([1, 2, 3, 4]);
  });

  it('filters to only tagged items for recommended and popular', () => {
    expect(nos(sortItems(list, 'recommended'))).toEqual([3]);
    expect(nos(sortItems(list, 'popular'))).toEqual([2, 4]);
  });

  it('sorts A–Z ignoring case', () => {
    expect(nos(sortItems(list, 'az'))).toEqual([2, 3, 4, 1]);
  });

  it('sorts by the price paid today, ties in shop order', () => {
    expect(nos(sortItems(list, 'priceAsc'))).toEqual([2, 4, 1, 3]);
    expect(nos(sortItems(list, 'priceDesc'))).toEqual([3, 1, 2, 4]);
  });

  it('does not change the input', () => {
    sortItems(list, 'az');
    expect(nos(list)).toEqual([1, 2, 3, 4]);
  });
});

describe('filterItems', () => {
  const list = [
    item(1, { categoryId: 'rockets', nameEn: 'Sky Rocket', isStandard: true }),
    item(2, { nameEn: 'Family Box' }),
    item(3, { weightGrams: 1000, nameEn: 'Green Bijili 1 kg' }),
    item(4, { weightGrams: 500, nameTe: 'చిచ్చుబుడ్లు', isStandard: true }),
  ];

  it('returns everything with no filter', () => {
    expect(nos(filterItems(list, {}))).toEqual([1, 2, 3, 4]);
    expect(nos(filterItems(list, { categoryId: '' }))).toEqual([1, 2, 3, 4]);
  });

  it('combines category, kilo, standard and search', () => {
    expect(nos(filterItems(list, { categoryId: 'rockets' }))).toEqual([1]);
    expect(nos(filterItems(list, { kiloOnly: true }))).toEqual([3, 4]);
    expect(nos(filterItems(list, { standardOnly: true }))).toEqual([1, 4]);
    expect(nos(filterItems(list, { kiloOnly: true, standardOnly: true }))).toEqual([4]);
    expect(nos(filterItems(list, { kiloOnly: true, search: 'bijili' }))).toEqual([3]);
    expect(nos(filterItems(list, { search: ' bijili ' }))).toEqual([3]);
    expect(nos(filterItems(list, { search: 'చిచ్చు' }))).toEqual([4]);
  });
});
