// Public, unauthenticated catalogue endpoints. Every shop query goes through
// the visible_shops view (G6), so unlicensed or unverified shops never appear.
import { createHash } from 'node:crypto';
import type { HttpRequest, HttpResponseInit } from '@azure/functions';
import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm';
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
import { TtlCache, catalogueTtlMs } from '../lib/cache';
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
  // Standard products each shop lists (same rule as its item list), for "Standard only" mode.
  const standardRows = await db
    .select({ shopId: items.shopId, n: count() })
    .from(items)
    .innerJoin(categories, eq(categories.id, items.categoryId))
    .where(
      and(
        inArray(items.shopId, ids),
        eq(items.isActive, true),
        eq(items.isStandard, true),
        eq(categories.isBanned, false),
      ),
    )
    .groupBy(items.shopId);

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
      standardCount: standardRows.find((r) => r.shopId === s.id)?.n ?? 0,
    };
  });
  return origin
    ? out.sort((a, b) => (a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9))
    : out.sort((a, b) => a.name.localeCompare(b.name));
}

// Public lists are the same for everyone, so at peak they are built once per instance every
// few seconds (see lib/cache.ts) instead of once per request.
// Built on first use with the configured TTL (CATALOGUE_CACHE_SECONDS, default 10 s; 0 = off).
const lazy = <T>(max: number) => {
  let c: TtlCache<T> | undefined;
  return () => (c ??= new TtlCache<T>(catalogueTtlMs(), max));
};
const listCache = lazy<ShopSummary[]>(1);
const areaCache = lazy<AreaSummary[]>(1);
const detailCache = lazy<ShopDetail>(10_000);
const itemsCache = lazy<{ body: ItemsResponse; etag: string }>(10_000);
const categoryCache = lazy<(typeof categories.$inferSelect)[]>(1);
const cached = <T>(cache: () => TtlCache<T>, key: string, load: () => Promise<T>) =>
  catalogueTtlMs() ? cache().get(key, load) : load();

/** GET /api/areas — distinct areas of listed shops with a centroid for the map. */
export async function areasHandler(): Promise<HttpResponseInit> {
  const body = await cached(areaCache, 'areas', loadAreas);
  return json(body, 200, { 'Cache-Control': 'public, max-age=60' });
}

async function loadAreas(): Promise<AreaSummary[]> {
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
  return rows.map((r) => ({ ...r, lat: r.lat ?? 0, lng: r.lng ?? 0 }));
}

const coord = z.coerce.number().finite().optional();
const NEAREST_LIMIT = 200;

/** GET /api/shops?area=&lat=&lng= */
export async function shopsHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const area = req.query.get('area')?.trim().toLowerCase() || null;
  const lat = parseQuery(req.query.get('lat'), coord);
  const lng = parseQuery(req.query.get('lng'), coord);
  const origin = lat !== undefined && lng !== undefined ? { lat, lng } : null;
  // One list of every listed shop (A–Z), shared by all callers; area and distance are applied
  // per request in memory.
  const all = await cached(listCache, 'all', async () => {
    const db = getDb();
    return summarize(db, await db.select().from(visibleShops), null);
  });
  const inArea = area ? all.filter((s) => s.area.toLowerCase() === area) : all;
  if (!origin) {
    return json(inArea, 200, { 'Cache-Control': 'public, max-age=30' });
  }
  const near = inArea
    .map((s) => ({
      ...s,
      distanceKm:
        s.lat != null && s.lng != null
          ? Math.round(haversineKm(origin, { lat: s.lat, lng: s.lng }) * 10) / 10
          : null,
    }))
    .sort((a, b) => (a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9));
  // Near me without an area: the nearest NEAREST_LIMIT shops are plenty for the screen and keep
  // the response small on a phone; an area list is returned whole.
  const body = area ? near : near.slice(0, NEAREST_LIMIT);
  // The caller's position is personal: never kept by a shared cache.
  return json(body, 200, { 'Cache-Control': 'private, max-age=30' });
}

/** GET /api/shops/{code} */
export async function shopDetailHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const code = (req.params.code ?? '').toUpperCase();
  const body = await cached(detailCache, code, async () => {
    const db = getDb();
    const shop = await findVisibleShop(db, code);
    const [summary] = await summarize(db, [shop], null);
    return {
      ...summary!,
      phone: shop.phoneE164,
      priceVersion: await getPriceVersion(db, shop.id),
    } satisfies ShopDetail;
  });
  return json(body);
}

/** GET /api/shops/{code}/items — ETag is a hash of the response body.
 *  Not just the price version: stock, sold-out flags and the response shape change without a
 *  price change, and a browser revalidating an old copy must not be told it is still current. */
export async function shopItemsHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const code = (req.params.code ?? '').toUpperCase();
  const { body, etag } = await cached(itemsCache, code, () => loadItems(code));
  const cache = { ETag: etag, 'Cache-Control': 'public, max-age=60' };
  if (req.headers.get('if-none-match') === etag) return { status: 304, headers: cache };
  return { status: 200, jsonBody: body, headers: cache };
}

async function loadItems(code: string): Promise<{ body: ItemsResponse; etag: string }> {
  const db = getDb();
  const shop = await findVisibleShop(db, code);
  const priceVersion = await getPriceVersion(db, shop.id);

  const [rows, allCats] = await Promise.all([
    db
      .select({ item: items, category: categories })
      .from(items)
      .innerJoin(categories, eq(categories.id, items.categoryId))
      .where(
        and(eq(items.shopId, shop.id), eq(items.isActive, true), eq(categories.isBanned, false)),
      )
      .orderBy(asc(categories.sort), asc(items.itemNo)),
    // The category list is the same for every shop: one query per cache window, not per shop.
    cached(categoryCache, 'all', () =>
      db
        .select()
        .from(categories)
        .where(eq(categories.isBanned, false))
        .orderBy(asc(categories.sort), asc(categories.nameEn)),
    ),
  ]);
  const body: ItemsResponse = {
    shopCode: shop.shortCode,
    priceVersion,
    categories: allCats.map(categoryView),
    items: rows.map((r) => itemView(r.item)),
  };
  const hash = createHash('sha256').update(JSON.stringify(body)).digest('base64url').slice(0, 22);
  return { body, etag: `"v${priceVersion}-${hash}"` };
}

http('areas', ['GET'], 'areas', areasHandler);
http('shops', ['GET'], 'shops', shopsHandler);
http('shopDetail', ['GET'], 'shops/{code}', shopDetailHandler);
http('shopItems', ['GET'], 'shops/{code}/items', shopItemsHandler);
