// Shop app (vendor). Owners edit the price list, hours and licence; counter
// staff toggle sold-out and serve visitors. The counter decodes the customer's
// list QR on the device: no endpoint here accepts a list (G1, G2).
import type { HttpRequest, HttpResponseInit } from '@azure/functions';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import {
  addDays,
  dateSchema,
  istDate,
  itemInputSchema,
  itemPatchSchema,
  licenceSubmitSchema,
  shopSettingsSchema,
  slotCapacitySchema,
  soldOutSchema,
  daySlotsSchema,
  visitCodeSchema,
  type ShopContext,
  type ShopToday,
} from '@pataka/shared';
import { getDb, type Db } from '../db/client';
import {
  categories,
  clusters,
  items,
  shopLicences,
  shops,
  slots,
  visibleShops,
  visits,
} from '../db/schema';
import { requireShop, requireUuidParam, type ShopRow } from '../lib/access';
import { audit } from '../lib/audit';
import { bumpPriceVersion, categoryView, getPriceVersion, itemView } from '../lib/catalogue';
import { HttpError } from '../lib/errors';
import { http, json, parseBody, parseQuery } from '../lib/http';
import { applyDaySlots, bookableDates, daySlots, ensureSlots, slotView } from '../lib/slots';
import { fileStore, licenceBlobPath, sniffImage } from '../lib/storage';
import { footfall, licenceView } from '../lib/reports';
import { addStrike, clusterView, queueVisitView, releaseSlot } from '../lib/visits';

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
    slotMinutes: shop.slotMinutes,
    defaultCapacityPerSlot: shop.defaultCapacityPerSlot,
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

// ---- Hours and slots ----

/** PUT /api/shop/settings — default hours/capacity, re-applied to upcoming days. */
export async function shopSettingsHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const db = getDb();
  const { user, shop } = await requireShop(db, req, { ownerOnly: true });
  const input = await parseBody(req, shopSettingsSchema);
  if (input.openFrom >= input.openTo) {
    throw new HttpError(400, 'invalid_body', 'Opening time must be before closing time');
  }
  await db.transaction(async (tx) => {
    await tx.update(shops).set(input).where(eq(shops.id, shop.id));
    // Today is left alone (visitors may already be on their way); later days follow the new hours.
    for (const date of bookableDates().slice(1)) {
      await applyDaySlots(
        tx,
        shop,
        date,
        input.openFrom,
        input.openTo,
        input.defaultCapacityPerSlot,
      );
    }
    await audit(tx, {
      actorUserId: user.id,
      action: 'shop.settings',
      entity: 'shop',
      entityId: shop.id,
      meta: input,
    });
  });
  const [fresh] = await db.select().from(shops).where(eq(shops.id, shop.id));
  return json(await shopContext(db, fresh!, true));
}

/** GET /api/shop/slots?date= */
export async function shopSlotsGetHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const db = getDb();
  const { shop } = await requireShop(db, req);
  const date = parseQuery(req.query.get('date') ?? istDate(), dateSchema);
  await ensureSlots(db, shop, date);
  const rows = await daySlots(db, shop.id, date);
  return json({ date, dates: bookableDates(), slots: rows.map((r) => slotView(r)) });
}

/** PUT /api/shop/slots {date, openFrom, openTo, capacity} — keeps booked slots. */
export async function shopSlotsPutHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const db = getDb();
  const { user, shop } = await requireShop(db, req, { ownerOnly: true });
  const input = await parseBody(req, daySlotsSchema);
  if (input.openFrom >= input.openTo) {
    throw new HttpError(400, 'invalid_body', 'Opening time must be before closing time');
  }
  if (input.date < istDate()) throw new HttpError(400, 'past_date', 'That day is over');
  await db.transaction(async (tx) => {
    await applyDaySlots(tx, shop, input.date, input.openFrom, input.openTo, input.capacity);
    await audit(tx, {
      actorUserId: user.id,
      action: 'slots.day',
      entity: 'shop',
      entityId: shop.id,
      meta: input,
    });
  });
  const rows = await daySlots(db, shop.id, input.date);
  return json({ date: input.date, dates: bookableDates(), slots: rows.map((r) => slotView(r)) });
}

/** PATCH /api/shop/slots/{id} {capacity} — never below what is already booked. */
export async function shopSlotCapacityHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const db = getDb();
  const { user, shop } = await requireShop(db, req, { ownerOnly: true });
  const id = requireUuidParam(req, 'id');
  const { capacity } = await parseBody(req, slotCapacitySchema);
  const [row] = await db
    .update(slots)
    .set({ capacity: sql`greatest(${capacity}, ${slots.booked})` })
    .where(and(eq(slots.id, id), eq(slots.shopId, shop.id)))
    .returning();
  if (!row) throw new HttpError(404, 'slot_not_found', 'No such slot');
  await audit(db, {
    actorUserId: user.id,
    action: 'slots.capacity',
    entity: 'slot',
    entityId: id,
    meta: { capacity },
  });
  return json(slotView(row));
}

// ---- Today's visitors ----

/** GET /api/shop/visits/today?date= — slot-wise list; the screen polls every 10 s. */
export async function shopTodayHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const db = getDb();
  const { shop } = await requireShop(db, req);
  const date = parseQuery(req.query.get('date') ?? istDate(), dateSchema);
  await ensureSlots(db, shop, date);
  const slotRows = await daySlots(db, shop.id, date);
  const visitRows = slotRows.length
    ? await db
        .select({ v: visits, s: slots })
        .from(visits)
        .innerJoin(slots, eq(slots.id, visits.slotId))
        .where(
          inArray(
            visits.slotId,
            slotRows.map((s) => s.id),
          ),
        )
        .orderBy(asc(visits.createdAt))
    : [];
  const body: ShopToday = {
    date,
    slots: slotRows.map((s) => ({
      ...slotView(s),
      visits: visitRows.filter((r) => r.s.id === s.id).map((r) => queueVisitView({ ...r, shop })),
    })),
  };
  return json(body);
}

async function loadShopVisit(db: Db, shopId: string, codeParam: string | undefined) {
  const code = visitCodeSchema.parse(codeParam);
  const [row] = await db
    .select({ v: visits, s: slots })
    .from(visits)
    .innerJoin(slots, eq(slots.id, visits.slotId))
    .where(eq(visits.code, code));
  if (!row) throw new HttpError(404, 'visit_not_found', 'No ticket with this code');
  if (row.v.shopId !== shopId) {
    throw new HttpError(409, 'wrong_shop', 'This ticket is for a different shop');
  }
  return row;
}

/** POST /api/shop/visits/{code}/serve — booked/arrived → served. Code only, no items. */
export async function shopServeHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const db = getDb();
  const { user, shop } = await requireShop(db, req);
  const row = await loadShopVisit(db, shop.id, req.params.code);
  if (row.v.status === 'served') return json(queueVisitView({ ...row, shop })); // idempotent (offline replay)
  if (row.v.status !== 'booked' && row.v.status !== 'arrived') {
    throw new HttpError(409, 'not_servable', `This ticket is ${row.v.status.replace('_', '-')}`);
  }
  const [v] = await db
    .update(visits)
    .set({ status: 'served', servedAt: sql`now()` })
    .where(eq(visits.id, row.v.id))
    .returning();
  await audit(db, {
    actorUserId: user.id,
    action: 'visit.serve',
    entity: 'visit',
    entityId: row.v.id,
  });
  return json(queueVisitView({ v: v!, s: row.s, shop }));
}

/** POST /api/shop/visits/{code}/no-show — frees the place and adds a strike. */
export async function shopNoShowHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const db = getDb();
  const { user, shop } = await requireShop(db, req);
  const row = await loadShopVisit(db, shop.id, req.params.code);
  if (row.v.status !== 'booked' && row.v.status !== 'arrived') {
    throw new HttpError(409, 'not_open', `This ticket is ${row.v.status.replace('_', '-')}`);
  }
  const updated = await db.transaction(async (tx) => {
    const [v] = await tx
      .update(visits)
      .set({ status: 'no_show', noShowAt: sql`now()` })
      .where(and(eq(visits.id, row.v.id), inArray(visits.status, ['booked', 'arrived'])))
      .returning();
    if (!v) throw new HttpError(409, 'not_open', 'This ticket changed, refresh');
    await releaseSlot(tx, row.v.slotId);
    await addStrike(tx, row.v.userId);
    await audit(tx, {
      actorUserId: user.id,
      action: 'visit.no_show',
      entity: 'visit',
      entityId: row.v.id,
    });
    return v;
  });
  return json(queueVisitView({ v: updated, s: row.s, shop }));
}

/** GET /api/shop/stats?from=&to= — footfall per day. */
export async function shopStatsHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const db = getDb();
  const { shop } = await requireShop(db, req, { ownerOnly: true });
  const to = parseQuery(req.query.get('to') ?? addDays(istDate(), 7), dateSchema);
  const from = parseQuery(req.query.get('from') ?? addDays(istDate(), -14), dateSchema);
  const rows = await footfall(db, [shop.id], from, to);
  return json({
    from,
    to,
    rows: rows.map(({ shopId: _s, medianArriveToServeMin: _m, ...r }) => r),
  });
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
http('shopSlotsGet', ['GET'], 'shop/slots', shopSlotsGetHandler);
http('shopSlotsPut', ['PUT'], 'shop/slots/day', shopSlotsPutHandler);
http('shopSlotCapacity', ['PATCH'], 'shop/slots/{id}', shopSlotCapacityHandler);
http('shopToday', ['GET'], 'shop/visits/today', shopTodayHandler);
http('shopServe', ['POST'], 'shop/visits/{code}/serve', shopServeHandler);
http('shopNoShow', ['POST'], 'shop/visits/{code}/no-show', shopNoShowHandler);
http('shopStats', ['GET'], 'shop/stats', shopStatsHandler);
http('shopLicenceList', ['GET'], 'shop/licence', shopLicenceListHandler);
http('shopLicenceSubmit', ['POST'], 'shop/licence/new', shopLicenceSubmitHandler);
