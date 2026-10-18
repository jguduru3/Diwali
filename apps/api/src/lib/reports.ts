import { and, gte, inArray, lt, sql } from 'drizzle-orm';
import { istDayRange, type FootfallRow, type Licence } from '@pataka/shared';
import type { Db } from '../db/client';
import { dailyShopStats, orders, shopLicences } from '../db/schema';
import type { ShopRow } from './access';

/**
 * The merchant's own daily numbers: orders placed (fee paid), completed,
 * cancelled, and their sales. Platform fees are not included (G4).
 */
export async function footfall(
  db: Db,
  shopIds: string[],
  from: string,
  to: string,
): Promise<(FootfallRow & { shopId: string })[]> {
  if (!shopIds.length) return [];
  const range = { from: istDayRange(from).from, to: istDayRange(to).to };
  const live = await db
    .select({
      shopId: orders.shopId,
      day: sql<string>`to_char((${orders.feePaidAt} at time zone 'Asia/Kolkata')::date, 'YYYY-MM-DD')`,
      orders: sql<number>`count(*)::int`,
      completed: sql<number>`count(*) filter (where ${orders.status} = 'completed')::int`,
      cancelled: sql<number>`count(*) filter (where ${orders.status} in ('cancelled','rejected','expired'))::int`,
      salesPaise: sql<number>`coalesce(sum(${orders.finalTotalPaise}) filter (where ${orders.status} = 'completed'), 0)::int`,
    })
    .from(orders)
    .where(
      and(
        inArray(orders.shopId, shopIds),
        gte(orders.feePaidAt, range.from),
        lt(orders.feePaidAt, range.to),
      ),
    )
    .groupBy(orders.shopId, sql`2`);
  // Stored rows survive the end-of-season purge; live rows win where both exist.
  const stored = await db
    .select()
    .from(dailyShopStats)
    .where(
      and(
        inArray(dailyShopStats.shopId, shopIds),
        gte(dailyShopStats.day, from),
        sql`${dailyShopStats.day} <= ${to}`,
      ),
    );
  const out = new Map<string, FootfallRow & { shopId: string }>();
  for (const s of stored) {
    out.set(`${s.shopId}:${s.day}`, {
      shopId: s.shopId,
      day: s.day,
      orders: s.orders,
      completed: s.completed,
      cancelled: s.cancelled,
      salesPaise: s.salesPaise,
    });
  }
  for (const l of live) out.set(`${l.shopId}:${l.day}`, l);
  return [...out.values()].sort((a, b) => a.day.localeCompare(b.day));
}

export function licenceView(
  l: typeof shopLicences.$inferSelect,
  shop: Pick<ShopRow, 'shortCode' | 'name'>,
): Licence {
  return {
    id: l.id,
    shopCode: shop.shortCode,
    shopName: shop.name,
    licenceNo: l.licenceNo,
    licenceType: l.licenceType,
    issuedBy: l.issuedBy,
    validFrom: l.validFrom,
    validTo: l.validTo,
    status: l.status,
    notes: l.notes,
    verifiedAt: l.verifiedAt?.toISOString() ?? null,
    createdAt: l.createdAt.toISOString(),
    hasImage: !!l.imageBlobPath,
  };
}
