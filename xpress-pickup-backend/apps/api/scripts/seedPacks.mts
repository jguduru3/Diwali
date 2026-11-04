// Demo packs and bundles: the same kit types at several shops with different prices and
// contents, so the "compare across shops" pages have something to compare.
// Item numbers 901+ keep clear of each shop's own list.
import { eq, inArray } from 'drizzle-orm';
import type { KitContents, KitType } from '@pataka/shared';
import type { Db } from '../src/db/client';
import { categories, items, shops } from '../src/db/schema';

type Pack = {
  itemNo: number;
  type: KitType;
  slug: string;
  en: string;
  te: string;
  hi: string;
  basePaise: number;
  contents: KitContents;
};

const PACKS: Pack[] = [
  {
    itemNo: 901,
    type: 'family',
    slug: 'family-packs',
    en: 'Family Pack',
    te: 'ఫ్యామిలీ ప్యాక్',
    hi: 'फ़ैमिली पैक',
    basePaise: 2_49_900,
    contents: [
      { name: 'Flower pots', qty: 10 },
      { name: 'Ground chakkar', qty: 10 },
      { name: 'Sparklers 15 cm', qty: 20 },
      { name: 'Twinkling stars', qty: 10 },
      { name: 'Aerial shots (12)', qty: 2 },
    ],
  },
  {
    itemNo: 902,
    type: 'kids',
    slug: 'kids-combo',
    en: 'Kids Pack',
    te: 'కిడ్స్ ప్యాక్',
    hi: 'किड्स पैक',
    basePaise: 99_900,
    contents: [
      { name: 'Sparklers 10 cm', qty: 20 },
      { name: 'Colour pencils', qty: 10 },
      { name: 'Flower pots small', qty: 5 },
      { name: 'Snake tablets', qty: 2 },
    ],
  },
  {
    itemNo: 903,
    type: 'economy',
    slug: 'family-packs',
    en: 'Economy Pack',
    te: 'ఎకానమీ ప్యాక్',
    hi: 'इकॉनमी पैक',
    basePaise: 69_900,
    contents: [
      { name: 'Sparklers 10 cm', qty: 10 },
      { name: 'Flower pots small', qty: 5 },
      { name: 'Ground chakkar', qty: 5 },
    ],
  },
  {
    itemNo: 904,
    type: 'vip',
    slug: 'gift-packs',
    en: 'VIP Pack',
    te: 'వీఐపీ ప్యాక్',
    hi: 'वीआईपी पैक',
    basePaise: 5_99_900,
    contents: [
      { name: 'Aerial shots (30)', qty: 2 },
      { name: 'Gold fountains', qty: 10 },
      { name: 'Flower pots deluxe', qty: 10 },
      { name: 'Sparklers 30 cm', qty: 20 },
      { name: 'Sky rockets', qty: 10 },
      { name: 'Gift box', qty: 1 },
    ],
  },
  {
    itemNo: 905,
    type: 'budget_1000',
    slug: 'gift-packs',
    en: '₹1,000 Bundle',
    te: '₹1,000 బండిల్',
    hi: '₹1,000 बंडल',
    basePaise: 1_00_000,
    contents: [
      { name: 'Flower pots', qty: 5 },
      { name: 'Sparklers 15 cm', qty: 10 },
      { name: 'Ground chakkar', qty: 5 },
    ],
  },
];

// Per-shop price factor and which packs each shop stocks (not every shop has every pack).
const SHOPS: { code: string; n: number; factor: number; has: number[] }[] = [
  { code: 'SLC01', n: 1, factor: 1.0, has: [901, 902, 903, 904, 905] },
  { code: 'ANA01', n: 2, factor: 0.94, has: [901, 902, 903, 905] },
  { code: 'BAL01', n: 3, factor: 1.06, has: [901, 903, 904] },
  { code: 'DEM01', n: 4, factor: 0.97, has: [901, 902, 904, 905] },
];

export async function seedPacks(db: Db) {
  const slugs = [...new Set(PACKS.map((p) => p.slug))];
  const cats = new Map(
    (
      await db
        .select({ id: categories.id, slug: categories.slug })
        .from(categories)
        .where(inArray(categories.slug, slugs))
    ).map((c) => [c.slug, c.id]),
  );
  let count = 0;
  for (const s of SHOPS) {
    const [shop] = await db
      .select({ id: shops.id })
      .from(shops)
      .where(eq(shops.shortCode, s.code))
      .limit(1);
    if (!shop) continue;
    for (const p of PACKS.filter((x) => s.has.includes(x.itemNo))) {
      const categoryId = cats.get(p.slug);
      if (!categoryId) continue;
      const pricePaise = Math.round((p.basePaise * s.factor) / 1000) * 1000 - 100;
      const values = {
        shopId: shop.id,
        itemNo: p.itemNo,
        categoryId,
        nameEn: p.en,
        nameTe: p.te,
        nameHi: p.hi,
        packDesc: `${p.contents.length} kinds`,
        pricePaise,
        // Same demo scheme as the shop's products: 89 + shop number + item number.
        barcode: `89${s.n}${String(p.itemNo).padStart(4, '0')}`,
        kind: 'kit' as const,
        kitType: p.type,
        contents: p.contents,
        isRecommended: p.type === 'family',
        isSoldOut: false,
        isActive: true,
      };
      await db
        .insert(items)
        .values(values)
        .onConflictDoUpdate({ target: [items.shopId, items.itemNo], set: values });
      count++;
    }
  }
  return count;
}
