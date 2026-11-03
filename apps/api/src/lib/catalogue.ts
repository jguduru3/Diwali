import { and, eq, sql } from 'drizzle-orm';
import {
  effectivePrice,
  generateStoreBarcode,
  resolvePricing,
  type Category,
  type Item,
  type Pricing,
  type PricingInput,
} from '@pataka/shared';
import { HttpError } from './errors';
import type { Db } from '../db/client';
import { categories, items, shopPriceVersions } from '../db/schema';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export async function getPriceVersion(db: Db | Tx, shopId: string): Promise<number> {
  const [row] = await db
    .select({ version: shopPriceVersions.version })
    .from(shopPriceVersions)
    .where(eq(shopPriceVersions.shopId, shopId));
  return row?.version ?? 1;
}

/** Any price/item change bumps the version so counters can flag stale lists (SPEC §7). */
export async function bumpPriceVersion(db: Db | Tx, shopId: string): Promise<number> {
  const [row] = await db
    .insert(shopPriceVersions)
    .values({ shopId, version: 2 })
    .onConflictDoUpdate({
      target: shopPriceVersions.shopId,
      set: { version: sql`${shopPriceVersions.version} + 1` },
    })
    .returning({ version: shopPriceVersions.version });
  return row!.version;
}

/** The price customers pay today, in SQL (offer while it runs), for lists built in the database. */
export const effectivePriceSql = sql`case when ${items.offerPricePaise} is not null and ${items.offerPricePaise} < ${items.pricePaise} and (${items.offerEndsAt} is null or ${items.offerEndsAt} > now()) then ${items.offerPricePaise} else ${items.pricePaise} end`;

/** Product photo URL: an uploaded photo (served by /api/media) wins over an external URL. */
export const itemImageUrl = (row: Pick<typeof items.$inferSelect, 'imagePath' | 'imageUrl'>) =>
  row.imagePath ? `/api/media/${row.imagePath}` : row.imageUrl;

export function itemView(row: typeof items.$inferSelect, now = new Date()): Item {
  return {
    id: row.id,
    itemNo: row.itemNo,
    categoryId: row.categoryId,
    nameEn: row.nameEn,
    nameTe: row.nameTe,
    nameHi: row.nameHi,
    packDesc: row.packDesc,
    pricePaise: row.pricePaise,
    priceVersion: row.priceVersion,
    greenCert: row.greenCert,
    greenRef: row.greenRef,
    rackCode: row.rackCode,
    imageUrl: itemImageUrl(row),
    barcode: row.barcode,
    stockQty: row.stockQty,
    offerPricePaise: row.offerPricePaise,
    offerEndsAt: row.offerEndsAt?.toISOString() ?? null,
    effectivePricePaise: effectivePrice(row, now),
    isSoldOut: row.isSoldOut,
    isActive: row.isActive,
    isRecommended: row.isRecommended,
    isPopular: row.isPopular,
    isStandard: row.isStandard,
    weightGrams: row.weightGrams,
    saleMode: row.saleMode,
    pricePerKgPaise: row.pricePerKgPaise,
    offerPricePerKgPaise: row.offerPricePerKgPaise,
    kind: row.kind,
    kitType: row.kitType,
    contents: row.contents,
  };
}

type ItemRow = typeof items.$inferSelect;
const PRICING_KEYS = [
  'saleMode',
  'pricePaise',
  'offerPricePaise',
  'pricePerKgPaise',
  'offerPricePerKgPaise',
  'weightGrams',
] as const;

/**
 * Server-side prices for a create (no current row) or an edit (merged over the current row).
 * Returns the six pricing columns, or nothing when an edit does not touch pricing.
 * The pack price of a kilo product is always derived here, never taken from the client (G11).
 */
export function pricingFor(input: Partial<PricingInput>): Pricing;
export function pricingFor(
  input: Partial<PricingInput>,
  current: Pick<ItemRow, (typeof PRICING_KEYS)[number]>,
): Partial<Pricing>;
export function pricingFor(
  input: Partial<PricingInput>,
  current?: Pick<ItemRow, (typeof PRICING_KEYS)[number]>,
): Partial<Pricing> {
  if (current && !PRICING_KEYS.some((k) => input[k] !== undefined)) return {};
  const pick = <K extends (typeof PRICING_KEYS)[number]>(k: K) =>
    input[k] !== undefined ? input[k] : current?.[k];
  const saleMode = pick('saleMode');
  if (!saleMode) throw new HttpError(400, 'invalid_body', 'Choose how the product is sold');
  const r = resolvePricing({
    saleMode,
    pricePaise: pick('pricePaise'),
    offerPricePaise: pick('offerPricePaise'),
    pricePerKgPaise: pick('pricePerKgPaise'),
    offerPricePerKgPaise: pick('offerPricePerKgPaise'),
    weightGrams: pick('weightGrams'),
  });
  if (!r.ok) throw new HttpError(422, r.code, r.message);
  return r.value;
}

/** A store barcode not yet used in this shop. Call under the shop's advisory lock. */
export async function freshBarcode(db: Db | Tx, shopId: string): Promise<string> {
  for (let i = 0; i < 8; i++) {
    const code = generateStoreBarcode();
    const [taken] = await db
      .select({ id: items.id })
      .from(items)
      .where(and(eq(items.shopId, shopId), eq(items.barcode, code)))
      .limit(1);
    if (!taken) return code;
  }
  throw new HttpError(503, 'barcode_unavailable', 'Could not generate a barcode; try again');
}

export function categoryView(row: typeof categories.$inferSelect): Category {
  return {
    id: row.id,
    slug: row.slug,
    nameEn: row.nameEn,
    nameTe: row.nameTe,
    nameHi: row.nameHi,
    sort: row.sort,
    isBanned: row.isBanned,
    bannedReason: row.bannedReason,
  };
}
