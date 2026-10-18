// Shop app (merchant). Owners manage products, photos, prices, offers, hours,
// licence and counter payment settings; staff confirm orders; packers pick and
// pack; cashiers hand over packs and take payment for the merchant (SPEC_V3).
import type { HttpRequest, HttpResponseInit } from '@azure/functions';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import {
  ITEM_IMAGE_MAX_BYTES,
  addDays,
  cardPaymentSchema,
  cashPaymentSchema,
  dateSchema,
  imageUploadSchema,
  istDate,
  itemInputSchema,
  itemPatchSchema,
  licenceSubmitSchema,
  lineRefSchema,
  merchantPaymentSettingsSchema,
  packScanSchema,
  proposeAlternateSchema,
  qrInputSchema,
  reasonSchema,
  shopSettingsSchema,
  soldOutSchema,
  type MerchantPaymentSettings,
  type OrderStatus,
  type ShopContext,
} from '@pataka/shared';
import type { z } from 'zod';
import { getDb, type Db } from '../db/client';
import {
  categories,
  clusters,
  items,
  merchantPaymentSettings,
  shopLicences,
  shops,
  visibleShops,
} from '../db/schema';
import { requireShop, requireUuidParam, type ShopRole, type ShopRow } from '../lib/access';
import { audit } from '../lib/audit';
import { bumpPriceVersion, categoryView, getPriceVersion, itemView } from '../lib/catalogue';
import { HttpError } from '../lib/errors';
import { http, json, parseBody, parseQuery } from '../lib/http';
import {
  confirmSimulatedUpi,
  matchPack,
  openByCustomerQr,
  paymentSettings,
  pollUpi,
  recordCard,
  recordCash,
  startUpi,
} from '../lib/counter';
import { env } from '../lib/env';
import {
  confirmOrder,
  finishPacking,
  markOutOfStock,
  pickByHand,
  proposeAlternate,
  rejectOrder,
  reprintSticker,
  scanItem,
  shopOrder,
  staffOrderSummaries,
  staffOrderView,
  startPacking,
} from '../lib/orders';
import { clusterView } from '../lib/places';
import { rateLimit } from '../lib/rateLimit';
import { footfall, licenceView } from '../lib/reports';
import { encryptSecret } from '../lib/secrets';
import { fileStore, itemImagePath, licenceBlobPath, sniffImage } from '../lib/storage';

// ---- Context ----

async function shopContext(
  db: Db,
  shop: ShopRow,
  canEdit: boolean,
  role: ShopRole,
): Promise<ShopContext> {
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
    role,
    cluster: clusterView(cluster ?? null),
  };
}

/** GET /api/shop/context */
export async function shopContextHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const db = getDb();
  const { shop, isOwner, role } = await requireShop(db, req);
  return json(await shopContext(db, shop, isOwner, role));
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
    items: rows.map((r) => itemView(r)),
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
  const { user, shop } = await requireShop(db, req, { can: 'catalogue' });
  const input = toItemValues(await parseBody(req, itemInputSchema));
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

/** API strings → DB values (offer end time is an ISO string on the wire). */
function toItemValues<T extends { offerEndsAt?: string | null }>(input: T) {
  const { offerEndsAt, ...rest } = input;
  return {
    ...rest,
    ...(offerEndsAt !== undefined
      ? { offerEndsAt: offerEndsAt ? new Date(offerEndsAt) : null }
      : {}),
  };
}

/** PATCH /api/shop/items/{id} — owners: any field; other staff: sold-out only. */
export async function shopItemPatchHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const db = getDb();
  const access = await requireShop(db, req, { can: 'soldOut' });
  const id = requireUuidParam(req, 'id');
  const patch = toItemValues(await parseBody(req, itemPatchSchema));
  const keys = Object.keys(patch);
  if (!access.isOwner && keys.some((k) => k !== 'isSoldOut')) {
    throw new HttpError(403, 'owner_only', 'Only the owner can change products and prices');
  }
  if (patch.categoryId) await assertCategoryAllowed(db, patch.categoryId);
  return json(await updateItem(db, access.shop.id, access.user.id, id, patch));
}

/** PATCH /api/shop/items/{id}/sold-out {isSoldOut} — owners, staff and packers. */
export async function shopItemSoldOutHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const db = getDb();
  const { shop, user } = await requireShop(db, req, { can: 'soldOut' });
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
  const { user, shop, role } = await requireShop(db, req, { ownerOnly: true });
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
  return json(await shopContext(db, fresh!, true, role));
}

// ---- Product photos ----

/** POST /api/shop/items/{id}/image {contentType, base64} — owner; stored in shop-media. */
export async function shopItemImageHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const db = getDb();
  const { user, shop } = await requireShop(db, req, { can: 'catalogue' });
  const id = requireUuidParam(req, 'id');
  const input = await parseBody(req, imageUploadSchema);
  const data = Buffer.from(input.base64, 'base64');
  const type = sniffImage(data);
  if (!type || data.length > ITEM_IMAGE_MAX_BYTES) {
    throw new HttpError(400, 'bad_image', 'Upload a JPEG, PNG or WebP photo up to 2 MB');
  }
  const [item] = await db
    .select({ id: items.id })
    .from(items)
    .where(and(eq(items.id, id), eq(items.shopId, shop.id)));
  if (!item) throw new HttpError(404, 'item_not_found', 'No such item');
  const path = itemImagePath(shop.id, randomUUID(), type.split('/')[1]!);
  await fileStore('shop-media').put(path, data, type);
  return json(await updateItem(db, shop.id, user.id, id, { imagePath: path }));
}

// ---- Orders: incoming, packing, counter ----

const VIEWS = {
  incoming: ['placed'],
  packing: ['confirmed', 'packing', 'awaiting_customer'],
  counter: ['packed'],
  done: ['completed', 'cancelled', 'rejected', 'expired'],
} as const satisfies Record<string, readonly OrderStatus[]>;

/** GET /api/shop/orders?view=incoming|packing|counter|done — polled every 10 s. */
export async function shopOrdersHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const db = getDb();
  const { shop } = await requireShop(db, req, { can: 'view' });
  const view = (req.query.get('view') ?? 'incoming') as keyof typeof VIEWS;
  if (!VIEWS[view]) throw new HttpError(400, 'bad_view', 'Unknown view');
  return json(await staffOrderSummaries(db, shop.id, VIEWS[view]));
}

/** GET /api/shop/orders/{id} */
export async function shopOrderHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const db = getDb();
  const { shop } = await requireShop(db, req, { can: 'view' });
  return json(await staffOrderView(db, await shopOrder(db, shop.id, requireUuidParam(req, 'id'))));
}

/** POST /api/shop/orders/{id}/confirm — within 3 days of the fee payment. */
export async function shopConfirmHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const db = getDb();
  const { user, shop } = await requireShop(db, req, { can: 'orders' });
  return json(await confirmOrder(db, shop.id, user.id, requireUuidParam(req, 'id')));
}

/** POST /api/shop/orders/{id}/reject {reason} — the customer's fee is refunded. */
export async function shopRejectHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const db = getDb();
  const { user, shop } = await requireShop(db, req, { can: 'orders' });
  const { reason } = await parseBody(req, reasonSchema);
  return json(await rejectOrder(db, shop.id, user.id, requireUuidParam(req, 'id'), reason));
}

const packer = (req: HttpRequest) => requireShop(getDb(), req, { can: 'packing' });

/** POST /api/shop/orders/{id}/start-packing */
export async function shopStartPackingHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const { user, shop } = await packer(req);
  return json(await startPacking(getDb(), shop.id, user.id, requireUuidParam(req, 'id')));
}

/** POST /api/shop/orders/{id}/scan {barcode} — one unit per scan. */
export async function shopScanHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const { user, shop } = await packer(req);
  const { barcode } = await parseBody(req, packScanSchema);
  return json(await scanItem(getDb(), shop.id, user.id, requireUuidParam(req, 'id'), barcode));
}

/** POST /api/shop/orders/{id}/pick {lineId} — items without a barcode only. */
export async function shopPickHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const { user, shop } = await packer(req);
  const { lineId } = await parseBody(req, lineRefSchema);
  return json(await pickByHand(getDb(), shop.id, user.id, requireUuidParam(req, 'id'), lineId));
}

/** POST /api/shop/orders/{id}/out-of-stock {lineId} — asks the customer. */
export async function shopOutOfStockHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const { user, shop } = await packer(req);
  const { lineId } = await parseBody(req, lineRefSchema);
  return json(await markOutOfStock(getDb(), shop.id, user.id, requireUuidParam(req, 'id'), lineId));
}

/** POST /api/shop/orders/{id}/alternate {lineId, itemId, qty} — asks the customer. */
export async function shopAlternateHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const { user, shop } = await packer(req);
  const input = await parseBody(req, proposeAlternateSchema);
  return json(
    await proposeAlternate(getDb(), shop.id, user.id, requireUuidParam(req, 'id'), input),
  );
}

/** POST /api/shop/orders/{id}/finish — pack number, total and the sticker QR. */
export async function shopFinishHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const { user, shop } = await packer(req);
  return json(await finishPacking(getDb(), shop.id, user.id, requireUuidParam(req, 'id')));
}

/** POST /api/shop/orders/{id}/sticker — reprint; the old sticker stops matching. */
export async function shopStickerHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const { user, shop } = await packer(req);
  return json(await reprintSticker(getDb(), shop.id, user.id, requireUuidParam(req, 'id')));
}

const cashier = (req: HttpRequest) => requireShop(getDb(), req, { can: 'counter' });

/** POST /api/shop/counter/open {qr} — customer's pickup QR. */
export async function counterOpenHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const db = getDb();
  const { user, shop } = await cashier(req);
  const { qr } = await parseBody(req, qrInputSchema);
  await rateLimit(db, `counter:${user.id}`, 120, 60);
  return json(await openByCustomerQr(db, shop, qr));
}

/** POST /api/shop/counter/{id}/pack {qr} — the pack sticker must match. */
export async function counterPackHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const { user, shop } = await cashier(req);
  const { qr } = await parseBody(req, qrInputSchema);
  return json(await matchPack(getDb(), shop, user.id, requireUuidParam(req, 'id'), qr));
}

/** POST /api/shop/counter/{id}/upi — start UPI to the merchant's YouPI-PG. No body. */
export async function counterUpiHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const { user, shop } = await cashier(req);
  return json(await startUpi(getDb(), shop, user.id, requireUuidParam(req, 'id')));
}

/** GET /api/shop/counter/{id} — poll; checks YouPI status server-side. */
export async function counterPollHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const { shop } = await cashier(req);
  return json(await pollUpi(getDb(), shop, requireUuidParam(req, 'id')));
}

/** POST /api/shop/counter/{id}/upi-simulated — dev/demo only. */
export async function counterUpiSimHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const { user, shop } = await cashier(req);
  return json(await confirmSimulatedUpi(getDb(), shop, user.id, requireUuidParam(req, 'id')));
}

/** POST /api/shop/counter/{id}/card {approvalCode} */
export async function counterCardHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const { user, shop } = await cashier(req);
  const { approvalCode } = await parseBody(req, cardPaymentSchema);
  return json(await recordCard(getDb(), shop, user.id, requireUuidParam(req, 'id'), approvalCode));
}

/** POST /api/shop/counter/{id}/cash {receivedPaise} */
export async function counterCashHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const { user, shop } = await cashier(req);
  const { receivedPaise } = await parseBody(req, cashPaymentSchema);
  return json(await recordCash(getDb(), shop, user.id, requireUuidParam(req, 'id'), receivedPaise));
}

// ---- Counter payment settings (owner; the platform team can also set them) ----

export async function settingsView(db: Db, shop: ShopRow): Promise<MerchantPaymentSettings> {
  const s = await paymentSettings(db, shop.id);
  return {
    youpiBaseUrl: s.youpiBaseUrl,
    youpiMerchantId: s.youpiMerchantId,
    hasWebhookSecret: !!s.youpiWebhookSecretEnc,
    upiVpa: s.upiVpa,
    acceptsCard: s.acceptsCard,
    acceptsCash: s.acceptsCash,
    webhookUrl: `${env.publicOrigin()}/api/payments/youpi/${shop.shortCode}`,
  };
}

export async function saveSettings(
  db: Db,
  shop: ShopRow,
  actorId: string,
  input: z.infer<typeof merchantPaymentSettingsSchema>,
) {
  const { youpiWebhookSecret, ...rest } = input;
  const values = {
    ...rest,
    ...(youpiWebhookSecret ? { youpiWebhookSecretEnc: encryptSecret(youpiWebhookSecret) } : {}),
  };
  await db
    .insert(merchantPaymentSettings)
    .values({ shopId: shop.id, ...values })
    .onConflictDoUpdate({ target: merchantPaymentSettings.shopId, set: values });
  await audit(db, {
    actorUserId: actorId,
    action: 'shop.payment_settings',
    entity: 'shop',
    entityId: shop.id,
    meta: { ...rest, webhookSecretChanged: !!youpiWebhookSecret },
  });
  return settingsView(db, shop);
}

/** GET /api/shop/payment-settings */
export async function paymentSettingsGetHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const db = getDb();
  const { shop } = await requireShop(db, req, { ownerOnly: true });
  return json(await settingsView(db, shop));
}

/** PUT /api/shop/payment-settings */
export async function paymentSettingsPutHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const db = getDb();
  const { user, shop } = await requireShop(db, req, { ownerOnly: true });
  const input = await parseBody(req, merchantPaymentSettingsSchema);
  return json(await saveSettings(db, shop, user.id, input));
}

/** GET /api/shop/stats?from=&to= — the merchant's own orders and sales per day. */
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
http('shopItemImage', ['POST'], 'shop/items/{id}/image', shopItemImageHandler);
http('shopOrders', ['GET'], 'shop/orders', shopOrdersHandler);
http('shopOrder', ['GET'], 'shop/orders/{id}', shopOrderHandler);
http('shopConfirm', ['POST'], 'shop/orders/{id}/confirm', shopConfirmHandler);
http('shopReject', ['POST'], 'shop/orders/{id}/reject', shopRejectHandler);
http('shopStartPacking', ['POST'], 'shop/orders/{id}/start-packing', shopStartPackingHandler);
http('shopScan', ['POST'], 'shop/orders/{id}/scan', shopScanHandler);
http('shopPick', ['POST'], 'shop/orders/{id}/pick', shopPickHandler);
http('shopOutOfStock', ['POST'], 'shop/orders/{id}/out-of-stock', shopOutOfStockHandler);
http('shopAlternate', ['POST'], 'shop/orders/{id}/alternate', shopAlternateHandler);
http('shopFinish', ['POST'], 'shop/orders/{id}/finish', shopFinishHandler);
http('shopSticker', ['POST'], 'shop/orders/{id}/sticker', shopStickerHandler);
http('counterOpen', ['POST'], 'shop/counter/open', counterOpenHandler);
http('counterPoll', ['GET'], 'shop/counter/{id}', counterPollHandler);
http('counterPack', ['POST'], 'shop/counter/{id}/pack', counterPackHandler);
http('counterUpi', ['POST'], 'shop/counter/{id}/upi', counterUpiHandler);
http('counterUpiSim', ['POST'], 'shop/counter/{id}/upi-simulated', counterUpiSimHandler);
http('counterCard', ['POST'], 'shop/counter/{id}/card', counterCardHandler);
http('counterCash', ['POST'], 'shop/counter/{id}/cash', counterCashHandler);
http('shopPaymentSettingsGet', ['GET'], 'shop/payment-settings', paymentSettingsGetHandler);
http('shopPaymentSettingsPut', ['PUT'], 'shop/payment-settings', paymentSettingsPutHandler);
http('shopStats', ['GET'], 'shop/stats', shopStatsHandler);
http('shopLicenceList', ['GET'], 'shop/licence', shopLicenceListHandler);
http('shopLicenceSubmit', ['POST'], 'shop/licence/new', shopLicenceSubmitHandler);
