// Standard kits: the same five types at every merchant, each shop with its own contents and price.
// Customers compare one kit type across listed shops (G6: visible_shops only).
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { haversineKm, KIT_TYPES, type KitOffer, type KitType } from '@pataka/shared';
import type { Db } from '../../db/client';
import { items, visibleShops } from '../../db/schema';
import { effectivePriceSql, itemImageUrl } from '../catalogue';

const kitWhere = (type?: KitType) =>
  and(
    eq(items.kind, 'kit'),
    type ? eq(items.kitType, type) : undefined,
    eq(items.isActive, true),
    eq(items.isSoldOut, false),
    isNull(items.removedAt),
  );

/** Each kit type with how many listed shops offer it and the lowest price. */
export async function kitTypes(db: Db) {
  const rows = await db
    .select({
      type: items.kitType,
      shops: sql<number>`count(distinct ${items.shopId})::int`,
      fromPaise: sql<number>`min(${effectivePriceSql})::int`,
    })
    .from(items)
    .innerJoin(visibleShops, eq(visibleShops.id, items.shopId))
    .where(kitWhere())
    .groupBy(items.kitType);
  return KIT_TYPES.map((type) => {
    const r = rows.find((x) => x.type === type);
    return { type, shops: r?.shops ?? 0, fromPaise: r?.fromPaise ?? null };
  });
}

/** Listed shops offering this kit type, nearest first when the caller's position is known. */
export async function kitOffers(
  db: Db,
  type: KitType,
  origin: { lat: number; lng: number } | null,
): Promise<KitOffer[]> {
  const rows = await db
    .select({
      item: items,
      shop: {
        shortCode: visibleShops.shortCode,
        name: visibleShops.name,
        area: visibleShops.area,
        lat: visibleShops.lat,
        lng: visibleShops.lng,
      },
      price: sql<number>`${effectivePriceSql}::int`,
    })
    .from(items)
    .innerJoin(visibleShops, eq(visibleShops.id, items.shopId))
    .where(kitWhere(type))
    .orderBy(asc(items.pricePaise))
    .limit(300);
  const out = rows.map((r) => ({
    shopCode: r.shop.shortCode,
    shopName: r.shop.name,
    area: r.shop.area,
    distanceKm:
      origin && r.shop.lat != null && r.shop.lng != null
        ? Math.round(haversineKm(origin, { lat: r.shop.lat, lng: r.shop.lng }) * 10) / 10
        : null,
    itemId: r.item.id,
    name: r.item.nameEn,
    pricePaise: r.price,
    imageUrl: itemImageUrl(r.item),
    contents: r.item.contents ?? [],
  }));
  return origin ? out.sort((a, b) => (a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9)) : out;
}
