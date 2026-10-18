// Shop app (vendor). Owners edit the price list, hours and licence; counter
// staff toggle sold-out and check Express Passes. The counter decodes the
// customer's list QR on the device: no endpoint here accepts a list (G1, G2).
import type { HttpRequest, HttpResponseInit } from '@azure/functions';
import { and, asc, desc, eq, gte, lt, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import {
  addDays,
  dateSchema,
  formatPassRef,
  istDate,
  istDayRange,
  itemInputSchema,
  itemPatchSchema,
  licenceSubmitSchema,
  shopSettingsSchema,
  soldOutSchema,
  verifyPassSchema,
  type ShopContext,
  type ShopScans,
} from '@pataka/shared';
import { getDb, type Db } from '../db/client';
import {
  categories,
  clusters,
  items,
  passes,
  passScans,
  shopLicences,
  shops,
  visibleShops,
} from '../db/schema';
import { requireShop, requireUuidParam, type ShopRow } from '../lib/access';
import { audit } from '../lib/audit';
import { bumpPriceVersion, categoryView, getPriceVersion, itemView } from '../lib/catalogue';
import { HttpError } from '../lib/errors';
import { http, json, parseBody, parseQuery } from '../lib/http';
import { fileStore, licenceBlobPath, sniffImage } from '../lib/storage';
import { footfall, licenceView } from '../lib/reports';
import { verifyPass } from '../lib/passes';
import { clusterView } from '../lib/places';
import { rateLimit } from '../lib/rateLimit';

// ---- Context ----

async function shopContext(db: Db, shop: ShopRow, canEdit: boolean): Promise<ShopContext> {
  const [visible] = await db
    .select({ id: visibleShops.id })
    .from(visibleShops)
    .where(eq(visibleShops.id, shop.id));
  const [cluster] = shop.clusterId
    ? await db.select().from(clusters).where(eq(clusters.id, shop.clusterId))
    : [];
  return {
    shopCode: shop.shortCode,
    name: shop.name,
    area: shop.area,
    isLive: shop.isLive,
    visible: !!visible,
    openFrom: shop.openFrom?.slice(0, 5) ?? null,
    openTo: shop.openTo?.slice(0, 5) ?? null,
    priceVersion: await getPriceVersion(db, shop.id),
    canEdit,
    cluster: clusterView(cluster ?? null),
  };
}

/** GET /api/shop/context */
export async function shopContextHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const db = getDb();
  const { shop, isOwner } = await requireShop(db, req);
  return json(await shopContext(db, shop, isOwner));
}

// ---- Price list ----

/** GET /api/shop/items — every item incl. inactive, plus categories for the editor. */
export async function shopItemsListHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const db = getDb();
  const { shop } = await requireShop(db, req);
  const [rows, cats] = await Promise.all([
    db.select().from(items).where(eq(items.shopId, shop.id)).orderBy(asc(items.itemNo)),
    db.select().from(categories).orderBy(asc(categories.sort), asc(categories.nameEn)),
  ]);
  return json({
    shopCode: shop.shortCode,
    priceVersion: await getPriceVersion(db, shop.id),
    categories: cats.map(categoryView),
    items: rows.map(itemView),
  });
}

async function assertCategoryAllowed(db: Db, categoryId: string) {
  const [cat] = await db.select().from(categories).where(eq(categories.id, categoryId));
  if (!cat) throw new HttpError(400, 'category_not_found', 'Unknown category');
  if (cat.isBanned) {
    throw new HttpError(422, 'category_banned', cat.bannedReason ?? 'This category is banned');
  }
}

/** POST /api/shop/items (owner) */
export async function shopItemCreateHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const db = getDb();
  const { user, shop } = await requireShop(db, req, { ownerOnly: true });
  const input = await parseBody(req, itemInputSchema);
  await assertCategoryAllowed(db, input.categoryId);
  const created = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${shop.id}))`);
    const [{ next } = { next: 1 }] = await tx
      .select({ next: sql<number>`coalesce(max(${items.itemNo}), 0)::int + 1` })
      .from(items)
      .where(eq(items.shopId, shop.id));
    const version = await bumpPriceVersion(tx, shop.id);
    const [row] = await tx
      .insert(items)
      .values({ ...input, shopId: shop.id, itemNo: next, priceVersion: version })
      .returning();
    await audit(tx, {
      actorUserId: user.id,
      action: 'item.create',
      entity: 'item',
      entityId: row!.id,
    });
    return row!;
  });
  return json(itemView(created), 201);
}

/** PATCH /api/shop/items/{id} — owners: any field; staff: sold-out only. */
export async function shopItemPatchHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const db = getDb();
  const access = await requireShop(db, req);
  const id = requireUuidParam(req, 'id');
  const patch = await parseBody(req, itemPatchSchema);
  const keys = Object.keys(patch);
  if (!access.isOwner && keys.some((k) => k !== 'isSoldOut')) {
    throw new HttpError(403, 'owner_only', 'Counter staff can only mark items sold out');
  }
  if (patch.categoryId) await assertCategoryAllowed(db, patch.categoryId);
  return json(await updateItem(db, access.shop.id, access.user.id, id, patch));
}

/** PATCH /api/shop/items/{id}/sold-out {isSoldOut} — owners and staff. */
export async function shopItemSoldOutHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const db = getDb();
  const { shop, user } = await requireShop(db, req);
  const id = requireUuidParam(req, 'id');
  const { isSoldOut } = await parseBody(req, soldOutSchema);
  return json(await updateItem(db, shop.id, user.id, id, { isSoldOut }));
}

async function updateItem(
  db: Db,
  shopId: string,
  actorId: string,
  id: string,
  patch: Partial<typeof items.$inferInsert>,
) {
  if (!Object.keys(patch).length) throw new HttpError(400, 'invalid_body', 'Nothing to change');
  return db.transaction(async (tx) => {
    const version = await bumpPriceVersion(tx, shopId);
    const [row] = await tx
      .update(items)
      .set({ ...patch, ...(patch.pricePaise !== undefined ? { priceVersion: version } : {}) })
      .where(and(eq(items.id, id), eq(items.shopId, shopId)))
      .returning();
    if (!row) throw new HttpError(404, 'item_not_found', 'No such item');
    await audit(tx, {
      actorUserId: actorId,
      action: 'item.update',
      entity: 'item',
      entityId: id,
      meta: patch,
    });
    return itemView(row);
  });
}

// ---- Hours ----

/** PUT /api/shop/settings — opening hours (shown as open/closed on the shop list). */
export async function shopSettingsHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const db = getDb();
  const { user, shop } = await requireShop(db, req, { ownerOnly: true });
  const input = await parseBody(req, shopSettingsSchema);
  if (input.openFrom >= input.openTo) {
    throw new HttpError(400, 'invalid_body', 'Opening time must be before closing time');
  }
  await db.update(shops).set(input).where(eq(shops.id, shop.id));
  await audit(db, {
    actorUserId: user.id,
    action: 'shop.settings',
    entity: 'shop',
    entityId: shop.id,
    meta: input,
  });
  const [fresh] = await db.select().from(shops).where(eq(shops.id, shop.id));
  return json(await shopContext(db, fresh!, true));
}

// ---- Express Pass verification ----

/** POST /api/shop/passes/verify {qr} — owners and counter staff of a listed shop. */
export async function shopVerifyHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const db = getDb();
  const { user, shop } = await requireShop(db, req);
  const { qr } = await parseBody(req, verifyPassSchema);
  const [visible] = await db
    .select({ id: visibleShops.id })
    .from(visibleShops)
    .where(eq(visibleShops.id, shop.id));
  if (!visible) {
    throw new HttpError(
      403,
      'shop_not_listed',
      'Only listed shops with a verified licence can check passes',
    );
  }
  await rateLimit(db, `verify:${user.id}`, 120, 60);
  return json(await verifyPass(db, qr, { shopId: shop.id }, user.id));
}

/** GET /api/shop/passes/scans?date= — this shop's checks for the day; polled every 10 s. */
export async function shopScansHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const db = getDb();
  const { shop } = await requireShop(db, req);
  const date = parseQuery(req.query.get('date') ?? istDate(), dateSchema);
  const { from, to } = istDayRange(date);
  const rows = await db
    .select({ s: passScans, ref: passes.ref })
    .from(passScans)
    .leftJoin(passes, eq(passes.id, passScans.passId))
    .where(and(eq(passScans.shopId, shop.id), gte(passScans.at, from), lt(passScans.at, to)))
    .orderBy(desc(passScans.at))
    .limit(300);
  const body: ShopScans = {
    date,
    scans: rows.map((r) => ({
      id: r.s.id,
      at: r.s.at.toISOString(),
      result: r.s.result,
      flag: r.s.flag,
      passRef: r.ref ? formatPassRef(r.ref) : null,
      place: shop.name,
    })),
  };
  return json(body);
}

/** GET /api/shop/stats?from=&to= — pass checks per day (footfall only, G4). */
export async function shopStatsHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const db = getDb();
  const { shop } = await requireShop(db, req, { ownerOnly: true });
  const to = parseQuery(req.query.get('to') ?? istDate(), dateSchema);
  const from = parseQuery(req.query.get('from') ?? addDays(istDate(), -14), dateSchema);
  const rows = await footfall(db, [shop.id], from, to);
  return json({ from, to, rows: rows.map(({ shopId: _s, ...r }) => r) });
}

// ---- Licence ----

/** GET /api/shop/licence — this shop's licences, newest first. */
export async function shopLicenceListHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const db = getDb();
  const { shop } = await requireShop(db, req, { ownerOnly: true });
  const rows = await db
    .select()
    .from(shopLicences)
    .where(eq(shopLicences.shopId, shop.id))
    .orderBy(desc(shopLicences.createdAt));
  return json(rows.map((l) => licenceView(l, shop)));
}

/** POST /api/shop/licence — photo + details; status starts as pending until an admin checks it. */
export async function shopLicenceSubmitHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const db = getDb();
  const { user, shop } = await requireShop(db, req, { ownerOnly: true });
  const input = await parseBody(req, licenceSubmitSchema);
  const data = Buffer.from(input.image.base64, 'base64');
  const type = sniffImage(data);
  if (!type) throw new HttpError(400, 'bad_image', 'Upload a JPEG, PNG or WebP photo');
  const id = randomUUID();
  const path = licenceBlobPath(shop.id, id, type.split('/')[1]!);
  await fileStore().put(path, data, type);
  const [row] = await db
    .insert(shopLicences)
    .values({
      id,
      shopId: shop.id,
      licenceNo: input.licenceNo,
      licenceType: input.licenceType,
      issuedBy: input.issuedBy ?? null,
      validFrom: input.validFrom,
      validTo: input.validTo,
      imageBlobPath: path,
    })
    .returning();
  await audit(db, {
    actorUserId: user.id,
    action: 'licence.submit',
    entity: 'licence',
    entityId: id,
  });
  return json(licenceView(row!, shop), 201);
}

http('shopContext', ['GET'], 'shop/context', shopContextHandler);
http('shopItemsList', ['GET'], 'shop/items', shopItemsListHandler);
http('shopItemCreate', ['POST'], 'shop/items/new', shopItemCreateHandler);
http('shopItemPatch', ['PATCH'], 'shop/items/{id}', shopItemPatchHandler);
http('shopItemSoldOut', ['PATCH'], 'shop/items/{id}/sold-out', shopItemSoldOutHandler);
http('shopSettings', ['PUT'], 'shop/settings', shopSettingsHandler);
http('shopVerify', ['POST'], 'shop/passes/verify', shopVerifyHandler);
http('shopScans', ['GET'], 'shop/passes/scans', shopScansHandler);
http('shopStats', ['GET'], 'shop/stats', shopStatsHandler);
http('shopLicenceList', ['GET'], 'shop/licence', shopLicenceListHandler);
http('shopLicenceSubmit', ['POST'], 'shop/licence/new', shopLicenceSubmitHandler);
