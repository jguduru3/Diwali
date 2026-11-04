// Shop app (merchant). Owners manage products, photos, prices, offers, hours,
// licence and counter payment settings; staff confirm orders; packers pick and
// pack; cashiers hand over packs and take payment for the merchant (SPEC_V3).
import type { HttpRequest, HttpResponseInit } from '@azure/functions';
import { notifyOrderChanged } from '../lib/customerNotify';
import { and, asc, desc, eq, isNull, notInArray, or, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import {
  FINAL_ORDER_STATUSES,
  ITEM_IMAGE_MAX_BYTES,
  addDays,
  assistanceReviewSchema,
  cardPaymentSchema,
  cashPaymentSchema,
  dateSchema,
  imageUploadSchema,
  istDate,
  itemInputSchema,
  itemPatchSchema,
  type ItemPatch,
  licenceSubmitSchema,
  lineRefSchema,
  merchantPaymentSettingsSchema,
  packScanSchema,
  proposeAlternateSchema,
  qrImageUploadSchema,
  qrInputSchema,
  qrPaymentSchema,
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
  orderLines,
  orders,
  shopLicences,
  shops,
  visibleShops,
} from '../db/schema';
import { requireShop, requireUuidParam, type ShopRole, type ShopRow } from '../lib/access';
import { audit } from '../lib/audit';
import { subscriptionInvoices } from '../lib/invoices';
import {
  bumpPriceVersion,
  categoryView,
  freshBarcode,
  getPriceVersion,
  itemView,
  pricingFor,
} from '../lib/catalogue';
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
  recordQrPayment,
  startUpi,
} from '../lib/counter';
import { env } from '../lib/env';
import {
  callCustomer,
  confirmOrder,
  finishPacking,
  markOutOfStock,
  packPhotoResponse,
  pickByHand,
  proposeAlternate,
  rejectOrder,
  reprintSticker,
  savePackPhoto,
  reviewPickupAssistance,
  scanItem,
  shopAssistanceRequests,
  shopOrder,
  staffOrderSummaries,
  staffOrderView,
  startPacking,
} from '../lib/orders';
import { clusterView } from '../lib/places';
import { rateLimit } from '../lib/rateLimit';
import { footfall, formatShopAnalyticsCsv, licenceView, shopAnalytics } from '../lib/reports';
import { encryptSecret } from '../lib/secrets';
import {
  fileStore,
  itemImagePath,
  licenceBlobPath,
  qrImagePath,
  shopPhotoPath,
  sniffImage,
} from '../lib/storage';

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
    photoUrl: shop.photoUrl ?? null,
  };
}

/** GET /api/shop/context */
export async function shopContextHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const db = getDb();
  const { shop, isOwner, role } = await requireShop(db, req, { setup: true });
  return json(await shopContext(db, shop, isOwner, role));
}

// ---- Price list ----

/** GET /api/shop/items — every item incl. inactive (not removed), plus categories for the editor. */
export async function shopItemsListHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const db = getDb();
  const { shop } = await requireShop(db, req, { setup: true });
  const [rows, cats] = await Promise.all([
    db
      .select()
      .from(items)
      .where(and(eq(items.shopId, shop.id), isNull(items.removedAt)))
      .orderBy(asc(items.itemNo)),
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
  const { user, shop } = await requireShop(db, req, { setup: true, can: 'catalogue' });
  const body = await parseBody(req, itemInputSchema);
  const input = toItemValues(body);
  const pricing = pricingFor(body);
  await assertCategoryAllowed(db, input.categoryId);
  const created = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${shop.id}))`);
    const [{ next } = { next: 1 }] = await tx
      .select({ next: sql<number>`coalesce(max(${items.itemNo}), 0)::int + 1` })
      .from(items)
      .where(eq(items.shopId, shop.id));
    const version = await bumpPriceVersion(tx, shop.id);
    // Every new product gets its own store barcode unless the owner gave the box's barcode.
    const barcode = input.barcode ?? (await freshBarcode(tx, shop.id));
    const barcodeSource = input.barcode ? ('box' as const) : ('store' as const);
    const [row] = await tx
      .insert(items)
      .values({
        ...input,
        ...pricing,
        barcode,
        barcodeSource,
        shopId: shop.id,
        itemNo: next,
        priceVersion: version,
      })
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
  const access = await requireShop(db, req, { setup: true, can: 'soldOut' });
  const id = requireUuidParam(req, 'id');
  const body = await parseBody(req, itemPatchSchema);
  const keys = Object.keys(body);
  if (!access.isOwner && keys.some((k) => k !== 'isSoldOut')) {
    throw new HttpError(403, 'owner_only', 'Only the owner can change products and prices');
  }
  if (body.categoryId) await assertCategoryAllowed(db, body.categoryId);
  return json(await updateItem(db, access.shop.id, access.user.id, id, toItemValues(body), body));
}

/** PATCH /api/shop/items/{id}/sold-out {isSoldOut} — owners, staff and packers. */
export async function shopItemSoldOutHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const db = getDb();
  const { shop, user } = await requireShop(db, req, { can: 'soldOut' });
  const id = requireUuidParam(req, 'id');
  const { isSoldOut } = await parseBody(req, soldOutSchema);
  return json(await updateItem(db, shop.id, user.id, id, { isSoldOut }));
}

/**
 * DELETE /api/shop/items/{id} — owner removes a product. The row stays (order lines
 * reference it) but leaves every list and frees its barcode. Refused while an open
 * order still needs it.
 */
export async function shopItemRemoveHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const db = getDb();
  const { user, shop } = await requireShop(db, req, { setup: true, can: 'catalogue' });
  const id = requireUuidParam(req, 'id');
  await db.transaction(async (tx) => {
    const [item] = await tx
      .select()
      .from(items)
      .where(and(eq(items.id, id), eq(items.shopId, shop.id), isNull(items.removedAt)))
      .for('update');
    if (!item) throw new HttpError(404, 'item_not_found', 'No such item');
    const [open] = await tx
      .select({ id: orders.id })
      .from(orderLines)
      .innerJoin(orders, eq(orders.id, orderLines.orderId))
      .where(
        and(
          or(eq(orderLines.itemId, id), eq(orderLines.alternateItemId, id)),
          notInArray(orders.status, [...FINAL_ORDER_STATUSES]),
        ),
      )
      .limit(1);
    if (open) {
      throw new HttpError(
        409,
        'item_in_open_orders',
        'This product is in an open order. Hide it now and remove it once those orders are done.',
      );
    }
    await bumpPriceVersion(tx, shop.id);
    await tx
      .update(items)
      .set({ removedAt: new Date(), isActive: false, barcode: null })
      .where(eq(items.id, id));
    await audit(tx, {
      actorUserId: user.id,
      action: 'item.remove',
      entity: 'item',
      entityId: id,
      meta: { itemNo: item.itemNo, nameEn: item.nameEn, barcode: item.barcode },
    });
  });
  return { status: 204 };
}

async function updateItem(
  db: Db,
  shopId: string,
  actorId: string,
  id: string,
  input: Partial<typeof items.$inferInsert>,
  pricingInput: ItemPatch = {},
) {
  if (!Object.keys(input).length) throw new HttpError(400, 'invalid_body', 'Nothing to change');
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(items)
      .where(and(eq(items.id, id), eq(items.shopId, shopId), isNull(items.removedAt)))
      .for('update');
    if (!current) throw new HttpError(404, 'item_not_found', 'No such item');
    // Price fields are re-derived from the current row plus the edit, for both sale modes.
    const pricing = pricingFor(pricingInput, current);
    const patch: Partial<typeof items.$inferInsert> = { ...input, ...pricing };
    // Kits keep their type and contents; turning a kit into a product clears them.
    const kind = patch.kind ?? current.kind;
    if (kind === 'product') Object.assign(patch, { kitType: null, contents: null });
    else if (!(patch.kitType ?? current.kitType) || !(patch.contents ?? current.contents)) {
      throw new HttpError(400, 'invalid_body', 'A kit needs its type and contents');
    }
    const cert = patch.greenCert !== undefined ? patch.greenCert : current.greenCert;
    const ref = patch.greenRef !== undefined ? patch.greenRef : current.greenRef;
    if (!!cert !== !!ref) {
      throw new HttpError(
        400,
        'invalid_body',
        'Give both the certificate and its reference, or neither',
      );
    }
    if (input.barcode === null) {
      // Clearing the barcode asks for a new store barcode; a product always has one.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${shopId}))`);
      patch.barcode = await freshBarcode(tx, shopId);
      patch.barcodeSource = 'store';
    } else if (input.barcode !== undefined && input.barcode !== current.barcode) {
      patch.barcodeSource = 'box';
    }
    const version = await bumpPriceVersion(tx, shopId);
    const priceChanged =
      pricing.pricePaise !== undefined && pricing.pricePaise !== current.pricePaise;
    const [row] = await tx
      .update(items)
      .set({ ...patch, ...(priceChanged ? { priceVersion: version } : {}) })
      .where(eq(items.id, id))
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
  const { user, shop, role } = await requireShop(db, req, { setup: true, ownerOnly: true });
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

// ---- Tax invoices ----

/** GET /api/shop/invoices — the shop's season subscription GST invoices (owner). */
export async function shopInvoicesHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const db = getDb();
  const { shop } = await requireShop(db, req, { ownerOnly: true });
  return json(await subscriptionInvoices(db, shop.id));
}

// ---- Shop entrance photo ----

/**
 * POST /api/shop/photo {contentType, base64} — the shop entrance, shown to customers with the
 * shop's name. Owner, or the agent while setting the shop up; stored in shop-media.
 */
export async function shopPhotoHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const db = getDb();
  const { user, shop, role } = await requireShop(db, req, { setup: true, ownerOnly: true });
  const input = await parseBody(req, imageUploadSchema);
  const data = Buffer.from(input.base64, 'base64');
  const type = sniffImage(data);
  if (!type || data.length > ITEM_IMAGE_MAX_BYTES) {
    throw new HttpError(400, 'bad_image', 'Upload a JPEG, PNG or WebP photo up to 2 MB');
  }
  const path = shopPhotoPath(shop.id, randomUUID(), type.split('/')[1]!);
  await fileStore('shop-media').put(path, data, type);
  await db
    .update(shops)
    .set({ photoUrl: `/api/media/${path}` })
    .where(eq(shops.id, shop.id));
  await audit(db, {
    actorUserId: user.id,
    action: 'shop.photo',
    entity: 'shop',
    entityId: shop.id,
    meta: { path },
  });
  const [fresh] = await db.select().from(shops).where(eq(shops.id, shop.id));
  return json(await shopContext(db, fresh!, true, role));
}

// ---- Product photos ----

/** POST /api/shop/items/{id}/image {contentType, base64} — owner; stored in shop-media. */
export async function shopItemImageHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const db = getDb();
  const { user, shop } = await requireShop(db, req, { setup: true, can: 'catalogue' });
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
    .where(and(eq(items.id, id), eq(items.shopId, shop.id), isNull(items.removedAt)));
  if (!item) throw new HttpError(404, 'item_not_found', 'No such item');
  const path = itemImagePath(shop.id, randomUUID(), type.split('/')[1]!);
  await fileStore('shop-media').put(path, data, type);
  return json(
    await updateItem(
      db,
      shop.id,
      user.id,
      id,
      input.side === 'open' ? { imageOpenPath: path } : { imagePath: path },
    ),
  );
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

/**
 * POST /api/shop/orders/{id}/call — logs the call and returns the customer's number for the
 * phone's dialer (G9, amended 2026-11-04). Any shop role on an open order.
 */
export async function shopCallCustomerHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const db = getDb();
  const { user, shop } = await requireShop(db, req, { can: 'view' });
  const orderId = requireUuidParam(req, 'id');
  // a few tries per order (no answer, wrong moment), and no calling spree from one account
  await rateLimit(db, `call:order:${orderId}`, 3, 30 * 60);
  await rateLimit(db, `call:user:${user.id}`, 30, 60 * 60);
  return json(await callCustomer(db, shop.id, user.id, orderId));
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
  const { barcode, lineId } = await parseBody(req, packScanSchema);
  return json(
    await scanItem(getDb(), shop.id, user.id, requireUuidParam(req, 'id'), barcode, lineId),
  );
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
  const id = requireUuidParam(req, 'id');
  const view = await markOutOfStock(getDb(), shop.id, user.id, id, lineId);
  await notifyOrderChanged(getDb(), id);
  return json(view);
}

/** POST /api/shop/orders/{id}/alternate {lineId, itemId, qty} — asks the customer. */
export async function shopAlternateHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const { user, shop } = await packer(req);
  const input = await parseBody(req, proposeAlternateSchema);
  const id = requireUuidParam(req, 'id');
  const view = await proposeAlternate(getDb(), shop.id, user.id, id, input);
  await notifyOrderChanged(getDb(), id);
  return json(view);
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

/** POST /api/shop/orders/{id}/pack-photo {contentType, base64} — packed order with its sticker. */
export async function shopPackPhotoUploadHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const { user, shop } = await packer(req);
  const id = requireUuidParam(req, 'id');
  const input = await parseBody(req, imageUploadSchema);
  const data = Buffer.from(input.base64, 'base64');
  const type = sniffImage(data);
  if (!type || data.length > ITEM_IMAGE_MAX_BYTES) {
    throw new HttpError(400, 'bad_image', 'Upload a JPEG, PNG or WebP photo up to 2 MB');
  }
  return json(await savePackPhoto(getDb(), shop.id, user.id, id, data, type));
}

/** GET /api/shop/orders/{id}/pack-photo — any staff of this shop. */
export async function shopPackPhotoHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const db = getDb();
  const { shop } = await requireShop(db, req, { can: 'view' });
  return packPhotoResponse(await shopOrder(db, shop.id, requireUuidParam(req, 'id')));
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

/** POST /api/shop/counter/{id}/qr {reference?} — customer pays via PhonePe QR; cashier confirms. */
export async function counterQrHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const { user, shop } = await cashier(req);
  const input = await parseBody(req, qrPaymentSchema);
  return json(
    await recordQrPayment(getDb(), shop, user.id, requireUuidParam(req, 'id'), input.reference),
  );
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
    qrImageUrl: s.qrImagePath ? `/api/media/${s.qrImagePath}` : null,
    qrActive: s.qrActive ?? true,
    qrUploadedAt: s.qrUploadedAt?.toISOString() ?? null,
  };
}

export async function saveSettings(
  db: Db,
  shop: ShopRow,
  actorId: string,
  input: z.infer<typeof merchantPaymentSettingsSchema>,
) {
  const { youpiWebhookSecret, qrActive, ...rest } = input;
  const values = {
    ...rest,
    ...(qrActive !== undefined ? { qrActive } : {}),
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

/** GET /api/shop/payment-settings — accessible to cashiers and owners. */
export async function paymentSettingsGetHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const db = getDb();
  const { shop } = await requireShop(db, req, { can: 'counter' });
  return json(await settingsView(db, shop));
}

/** PUT /api/shop/payment-settings */
export async function paymentSettingsPutHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const db = getDb();
  const { user, shop } = await requireShop(db, req, { ownerOnly: true });
  const input = await parseBody(req, merchantPaymentSettingsSchema);
  return json(await saveSettings(db, shop, user.id, input));
}

/** POST /api/shop/payment-settings/qr {base64} — upload PhonePe payment QR. */
export async function shopPaymentSettingsQrHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const db = getDb();
  const { user, shop } = await requireShop(db, req, { ownerOnly: true });
  const input = await parseBody(req, qrImageUploadSchema);
  const base64Str = input.base64.replace(/^data:image\/[a-z]+;base64,/, '');
  const data = Buffer.from(base64Str, 'base64');
  const type = sniffImage(data);
  if (!type || data.length > 5 * 1024 * 1024) {
    throw new HttpError(400, 'bad_image', 'Upload a JPEG, PNG or WebP photo up to 5 MB');
  }
  const ext = type.split('/')[1] === 'jpeg' ? 'jpeg' : type.split('/')[1]!;
  const path = qrImagePath(shop.id, randomUUID(), ext);
  await fileStore('shop-media').put(path, data, type);
  const now = new Date();
  await db
    .insert(merchantPaymentSettings)
    .values({
      shopId: shop.id,
      qrImagePath: path,
      qrUploadedBy: user.id,
      qrUploadedAt: now,
      qrActive: true,
    })
    .onConflictDoUpdate({
      target: merchantPaymentSettings.shopId,
      set: {
        qrImagePath: path,
        qrUploadedBy: user.id,
        qrUploadedAt: now,
        qrActive: true,
        updatedAt: now,
      },
    });
  await audit(db, {
    actorUserId: user.id,
    action: 'shop.payment_settings_qr_upload',
    entity: 'shop',
    entityId: shop.id,
    meta: { path },
  });
  return json(await settingsView(db, shop));
}

/** DELETE /api/shop/payment-settings/qr — deactivate payment QR. */
export async function shopPaymentSettingsQrDeleteHandler(
  req: HttpRequest,
): Promise<HttpResponseInit> {
  const db = getDb();
  const { user, shop } = await requireShop(db, req, { ownerOnly: true });
  await db
    .update(merchantPaymentSettings)
    .set({ qrActive: false, updatedAt: new Date() })
    .where(eq(merchantPaymentSettings.shopId, shop.id));
  await audit(db, {
    actorUserId: user.id,
    action: 'shop.payment_settings_qr_delete',
    entity: 'shop',
    entityId: shop.id,
  });
  return json(await settingsView(db, shop));
}

/** GET /api/shop/analytics?from=&to=&cashierId=&method= — complete merchant analytics. */
export async function shopAnalyticsHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const db = getDb();
  const { shop } = await requireShop(db, req, { ownerOnly: true });
  const from = req.query.get('from')?.trim() || istDate();
  const to = req.query.get('to')?.trim() || istDate();
  const cashierId = req.query.get('cashierId')?.trim() || undefined;
  const method = req.query.get('method')?.trim() || undefined;
  const data = await shopAnalytics(db, shop.id, { from, to, cashierId, method });
  return json(data);
}

/** GET /api/shop/analytics/export?from=&to=&cashierId=&method= — Excel-compatible CSV export. */
export async function shopAnalyticsExportHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const db = getDb();
  const { shop } = await requireShop(db, req, { ownerOnly: true });
  const from = req.query.get('from')?.trim() || istDate();
  const to = req.query.get('to')?.trim() || istDate();
  const cashierId = req.query.get('cashierId')?.trim() || undefined;
  const method = req.query.get('method')?.trim() || undefined;
  const data = await shopAnalytics(db, shop.id, { from, to, cashierId, method });
  const csv = formatShopAnalyticsCsv(data, shop);
  return {
    status: 200,
    body: csv,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="sales-${shop.shortCode}-${from}-to-${to}.csv"`,
      'Cache-Control': 'no-store',
    },
  };
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
  const { shop } = await requireShop(db, req, { setup: true, ownerOnly: true });
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
  const { user, shop } = await requireShop(db, req, { setup: true, ownerOnly: true });
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

// ---- Arrival & Assistance Notifications ----

/** GET /api/shop/assistance-requests — active arrival notices and assistance requests for this shop */
export async function shopAssistanceRequestsHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const db = getDb();
  const { shop } = await requireShop(db, req);
  return json(await shopAssistanceRequests(db, shop.id));
}

/** POST /api/shop/orders/{id}/assistance-review {decision, notes?} — cashier reviews assistance request */
export async function shopAssistanceReviewHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const db = getDb();
  const { user, shop } = await requireShop(db, req);
  const input = await parseBody(req, assistanceReviewSchema);
  return json(
    await reviewPickupAssistance(db, shop.id, user.id, requireUuidParam(req, 'id'), input),
  );
}

http('shopContext', ['GET'], 'shop/context', shopContextHandler);
http('shopItemsList', ['GET'], 'shop/items', shopItemsListHandler);
http('shopItemCreate', ['POST'], 'shop/items/new', shopItemCreateHandler);
http('shopItemPatch', ['PATCH'], 'shop/items/{id}', shopItemPatchHandler);
http('shopItemSoldOut', ['PATCH'], 'shop/items/{id}/sold-out', shopItemSoldOutHandler);
http('shopItemRemove', ['DELETE'], 'shop/items/{id}', shopItemRemoveHandler);
http('shopSettings', ['PUT'], 'shop/settings', shopSettingsHandler);
http('shopItemImage', ['POST'], 'shop/items/{id}/image', shopItemImageHandler);
http('shopPhoto', ['POST'], 'shop/photo', shopPhotoHandler);
http('shopInvoices', ['GET'], 'shop/invoices', shopInvoicesHandler);
http('shopOrders', ['GET'], 'shop/orders', shopOrdersHandler);
http('shopOrder', ['GET'], 'shop/orders/{id}', shopOrderHandler);
http('shopCallCustomer', ['POST'], 'shop/orders/{id}/call', shopCallCustomerHandler);
http('shopConfirm', ['POST'], 'shop/orders/{id}/confirm', shopConfirmHandler);
http('shopReject', ['POST'], 'shop/orders/{id}/reject', shopRejectHandler);
http('shopStartPacking', ['POST'], 'shop/orders/{id}/start-packing', shopStartPackingHandler);
http('shopScan', ['POST'], 'shop/orders/{id}/scan', shopScanHandler);
http('shopPick', ['POST'], 'shop/orders/{id}/pick', shopPickHandler);
http('shopOutOfStock', ['POST'], 'shop/orders/{id}/out-of-stock', shopOutOfStockHandler);
http('shopAlternate', ['POST'], 'shop/orders/{id}/alternate', shopAlternateHandler);
http('shopFinish', ['POST'], 'shop/orders/{id}/finish', shopFinishHandler);
http('shopSticker', ['POST'], 'shop/orders/{id}/sticker', shopStickerHandler);
http('shopPackPhotoUpload', ['POST'], 'shop/orders/{id}/pack-photo', shopPackPhotoUploadHandler);
http('shopPackPhoto', ['GET'], 'shop/orders/{id}/pack-photo', shopPackPhotoHandler);
http('counterOpen', ['POST'], 'shop/counter/open', counterOpenHandler);
http('counterPoll', ['GET'], 'shop/counter/{id}', counterPollHandler);
http('counterPack', ['POST'], 'shop/counter/{id}/pack', counterPackHandler);
http('counterUpi', ['POST'], 'shop/counter/{id}/upi', counterUpiHandler);
http('counterUpiSim', ['POST'], 'shop/counter/{id}/upi-simulated', counterUpiSimHandler);
http('counterCard', ['POST'], 'shop/counter/{id}/card', counterCardHandler);
http('counterCash', ['POST'], 'shop/counter/{id}/cash', counterCashHandler);
http('counterQr', ['POST'], 'shop/counter/{id}/qr', counterQrHandler);
http('shopPaymentSettingsGet', ['GET'], 'shop/payment-settings', paymentSettingsGetHandler);
http('shopPaymentSettingsPut', ['PUT'], 'shop/payment-settings', paymentSettingsPutHandler);
http('shopPaymentSettingsQr', ['POST'], 'shop/payment-settings/qr', shopPaymentSettingsQrHandler);
http(
  'shopPaymentSettingsQrDelete',
  ['DELETE'],
  'shop/payment-settings/qr',
  shopPaymentSettingsQrDeleteHandler,
);
http('shopStats', ['GET'], 'shop/stats', shopStatsHandler);
http('shopAnalytics', ['GET'], 'shop/analytics', shopAnalyticsHandler);
http('shopAnalyticsExport', ['GET'], 'shop/analytics/export', shopAnalyticsExportHandler);
http('shopLicenceList', ['GET'], 'shop/licence', shopLicenceListHandler);
http('shopLicenceSubmit', ['POST'], 'shop/licence/new', shopLicenceSubmitHandler);
http('shopAssistanceRequests', ['GET'], 'shop/assistance-requests', shopAssistanceRequestsHandler);
http(
  'shopAssistanceReview',
  ['POST'],
  'shop/orders/{id}/assistance-review',
  shopAssistanceReviewHandler,
);
