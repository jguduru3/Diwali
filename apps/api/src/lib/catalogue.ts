import { eq, sql } from 'drizzle-orm';
import { effectivePrice, type Category, type Item } from '@pataka/shared';
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
    packDesc: row.packDesc,
    pricePaise: row.pricePaise,
    priceVersion: row.priceVersion,
    greenCert: row.greenCert,
    greenRef: row.greenRef,
    rackCode: row.rackCode,
    imageUrl: itemImageUrl(row),
    saleUnit: row.saleUnit,
    barcode: row.barcode,
    stockQty: row.stockQty,
    offerPricePaise: row.offerPricePaise,
    offerEndsAt: row.offerEndsAt?.toISOString() ?? null,
    effectivePricePaise: effectivePrice(row, now),
    isSoldOut: row.isSoldOut,
    isActive: row.isActive,
  };
}

export function categoryView(row: typeof categories.$inferSelect): Category {
  return {
    id: row.id,
    slug: row.slug,
    nameEn: row.nameEn,
    nameTe: row.nameTe,
    sort: row.sort,
    isBanned: row.isBanned,
    bannedReason: row.bannedReason,
  };
}
