// Public, unauthenticated catalogue endpoints. Every shop query goes through
// the visible_shops view (G6), so unlicensed or unverified shops never appear.
import type { HttpRequest, HttpResponseInit } from '@azure/functions';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  haversineKm,
  istTime,
  type AreaSummary,
  type ItemsResponse,
  type ShopDetail,
  type ShopSummary,
} from '@pataka/shared';
import { getDb, type Db } from '../db/client';
import { categories, clusters, items, shopLicences, visibleShops } from '../db/schema';
import { categoryView, getPriceVersion, itemView } from '../lib/catalogue';
import { HttpError } from '../lib/errors';
import { http, json, parseQuery } from '../lib/http';
import { clusterView } from '../lib/places';

type VisibleShop = typeof visibleShops.$inferSelect;

function isOpenNow(shop: Pick<VisibleShop, 'openFrom' | 'openTo'>, now = new Date()): boolean {
  if (!shop.openFrom || !shop.openTo) return false;
  const t = istTime(now);
  return t >= shop.openFrom.slice(0, 5) && t < shop.openTo.slice(0, 5);
}

async function findVisibleShop(db: Db, code: string | undefined): Promise<VisibleShop> {
  const [shop] = await db
    .select()
    .from(visibleShops)
    .where(eq(visibleShops.shortCode, (code ?? '').toUpperCase()));
  if (!shop) throw new HttpError(404, 'shop_not_found', 'This shop is not listed');
  return shop;
}

/** Builds list cards: current verified licence, cluster, distance. */
async function summarize(
  db: Db,
  shops: VisibleShop[],
  origin: { lat: number; lng: number } | null,
): Promise<ShopSummary[]> {
  if (!shops.length) return [];
  const ids = shops.map((s) => s.id);
  const licences = await db
    .select()
    .from(shopLicences)
    .where(
      and(
        inArray(shopLicences.shopId, ids),
        eq(shopLicences.status, 'verified'),
        sql`${shopLicences.validTo} >= (now() at time zone 'Asia/Kolkata')::date`,
      ),
    )
    .orderBy(desc(shopLicences.validTo));
  const clusterIds = shops.map((s) => s.clusterId).filter((x): x is string => !!x);
  const clusterRows = clusterIds.length
    ? await db.select().from(clusters).where(inArray(clusters.id, clusterIds))
    : [];

  const out = shops.map((s): ShopSummary => {
    const licence = licences.find((l) => l.shopId === s.id)!;
    return {
      shortCode: s.shortCode,
      name: s.name,
      area: s.area,
      address: s.address,
      lat: s.lat,
      lng: s.lng,
      photoUrl: s.photoUrl,
      openFrom: s.openFrom?.slice(0, 5) ?? null,
      openTo: s.openTo?.slice(0, 5) ?? null,
      openNow: isOpenNow(s),
      distanceKm:
        origin && s.lat != null && s.lng != null
          ? Math.round(haversineKm(origin, { lat: s.lat, lng: s.lng }) * 10) / 10
          : null,
      licence: {
        licenceNo: licence.licenceNo,
        licenceType: licence.licenceType,
        validTo: licence.validTo,
      },
      cluster: clusterView(clusterRows.find((c) => c.id === s.clusterId) ?? null),
    };
  });
  return origin
    ? out.sort((a, b) => (a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9))
    : out.sort((a, b) => a.name.localeCompare(b.name));
}

/** GET /api/areas — distinct areas of listed shops with a centroid for the map. */
export async function areasHandler(): Promise<HttpResponseInit> {
  const rows = await getDb()
    .select({
      area: visibleShops.area,
      lat: sql<number>`avg(${visibleShops.lat})::float8`,
      lng: sql<number>`avg(${visibleShops.lng})::float8`,
      shopCount: sql<number>`count(*)::int`,
    })
    .from(visibleShops)
    .groupBy(visibleShops.area)
    .orderBy(asc(visibleShops.area));
  const body: AreaSummary[] = rows.map((r) => ({ ...r, lat: r.lat ?? 0, lng: r.lng ?? 0 }));
  return json(body, 200, { 'Cache-Control': 'public, max-age=60' });
}

const coord = z.coerce.number().finite().optional();

/** GET /api/shops?area=&lat=&lng= */
export async function shopsHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const db = getDb();
  const area = req.query.get('area')?.trim() || null;
  const lat = parseQuery(req.query.get('lat'), coord);
  const lng = parseQuery(req.query.get('lng'), coord);
  const rows = await db
    .select()
    .from(visibleShops)
    .where(area ? sql`lower(${visibleShops.area}) = lower(${area})` : undefined);
  const origin = lat !== undefined && lng !== undefined ? { lat, lng } : null;
  return json(await summarize(db, rows, origin));
}

/** GET /api/shops/{code} */
export async function shopDetailHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const db = getDb();
  const shop = await findVisibleShop(db, req.params.code);
  const [summary] = await summarize(db, [shop], null);
  const body: ShopDetail = {
    ...summary!,
    phone: shop.phoneE164,
    priceVersion: await getPriceVersion(db, shop.id),
  };
  return json(body);
}

/**
 * Bump when the shape of an item in the response changes, so browsers holding
 * a cached list (same price version) refetch instead of getting a 304.
 */
export const ITEMS_SHAPE_VERSION = 2;

/** GET /api/shops/{code}/items — ETag is the response shape + price version. */
export async function shopItemsHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const db = getDb();
  const shop = await findVisibleShop(db, req.params.code);
  const priceVersion = await getPriceVersion(db, shop.id);
  const etag = `"s${ITEMS_SHAPE_VERSION}-v${priceVersion}"`;
  const cache = { ETag: etag, 'Cache-Control': 'public, max-age=60' };
  if (req.headers.get('if-none-match') === etag) return { status: 304, headers: cache };

  const rows = await db
    .select({ item: items, category: categories })
    .from(items)
    .innerJoin(categories, eq(categories.id, items.categoryId))
    .where(and(eq(items.shopId, shop.id), eq(items.isActive, true), eq(categories.isBanned, false)))
    .orderBy(asc(categories.sort), asc(items.itemNo));
  const cats = new Map(rows.map((r) => [r.category.id, categoryView(r.category)]));
  const body: ItemsResponse = {
    shopCode: shop.shortCode,
    priceVersion,
    categories: [...cats.values()].sort((a, b) => a.sort - b.sort),
    items: rows.map((r) => itemView(r.item)),
  };
  return { status: 200, jsonBody: body, headers: cache };
}

http('areas', ['GET'], 'areas', areasHandler);
http('shops', ['GET'], 'shops', shopsHandler);
http('shopDetail', ['GET'], 'shops/{code}', shopDetailHandler);
http('shopItems', ['GET'], 'shops/{code}/items', shopItemsHandler);
