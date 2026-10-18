// Order lifecycle (SPEC_V3). The server prices orders from the catalogue and
// enforces every transition (G11). The platform's only money is its flat fee,
// collected through the payment adapter and refunded by the rules in §4 (G3).
import { createHash, randomInt } from 'node:crypto';
import { and, asc, desc, eq, inArray, max, sql } from 'drizzle-orm';
import {
  PLATFORM_FEE_PAISE,
  ORDER_ALPHABET,
  ORDER_CODE_LENGTH,
  ORDER_SECRET_LENGTH,
  canTransition,
  confirmBy,
  effectivePrice,
  encodeOrderQr,
  feeOutcome,
  finalTotal,
  formatOrderCode,
  istDate,
  needsCustomer,
  readyToPack,
  staffPhoneMask,
  type Bill,
  type CustomerDecision,
  type CustomerOrder,
  type CustomerOrderSummary,
  type FeeState,
  type OrderLine,
  type OrderStatus,
  type PackSticker,
  type PlaceOrder,
  type ProposeAlternate,
  type StaffOrder,
  type StaffOrderLine,
  type StaffOrderSummary,
} from '@pataka/shared';
import type { Db } from '../db/client';
import {
  categories,
  clusters,
  counterPayments,
  feePaymentEvents,
  feePayments,
  feeRefunds,
  items,
  orderEvents,
  orderLines,
  orders,
  shopLicences,
  shops,
  users,
  visibleShops,
} from '../db/schema';
import { audit } from './audit';
import { itemImageUrl } from './catalogue';
import { env } from './env';
import { HttpError } from './errors';
import { pgError } from './http';
import {
  activeProvider,
  providerByName,
  WebhookSignatureError,
  type HeaderReader,
  type PaymentProvider,
  type ProviderEvent,
} from './payments';
import { mockId, mockProvider, signMockEvent } from './payments/mock';

export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type OrderRow = typeof orders.$inferSelect;
type LineRow = typeof orderLines.$inferSelect;
type ItemRow = typeof items.$inferSelect;
type ShopRow = typeof shops.$inferSelect;

/** An open fee checkout younger than this is reused, so retries never double-charge. */
export const CHECKOUT_REUSE_MINUTES = 30;

const random = (n: number) =>
  Array.from({ length: n }, () => ORDER_ALPHABET[randomInt(ORDER_ALPHABET.length)]).join('');
export const newOrderCode = () => random(ORDER_CODE_LENGTH);
export const newQrSecret = () => random(ORDER_SECRET_LENGTH);
export const hashSecret = (s: string) => createHash('sha256').update(s).digest('hex');
export const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const iso = (d: Date | null) => (d ? d.toISOString() : null);

// ---- Events and transitions ----

export async function orderEvent(
  db: Db | Tx,
  orderId: string,
  actorUserId: string | null,
  type: string,
  meta?: Record<string, unknown>,
) {
  await db.insert(orderEvents).values({ orderId, actorUserId, type, meta: meta ?? null });
  await audit(db, {
    actorUserId,
    action: `order.${type}`,
    entity: 'order',
    entityId: orderId,
    meta,
  });
}

/**
 * Moves an order to `to` if the state machine allows it AND nobody changed it
 * meanwhile (compare-and-set on the current status).
 */
export async function transition(
  tx: Tx,
  order: OrderRow,
  to: OrderStatus,
  patch: Partial<typeof orders.$inferInsert>,
  actorId: string | null,
  type: string,
  meta?: Record<string, unknown>,
): Promise<OrderRow> {
  if (!canTransition(order.status, to)) {
    throw new HttpError(409, 'bad_state', `This order is ${order.status.replace('_', ' ')}`);
  }
  const [row] = await tx
    .update(orders)
    .set({ ...patch, status: to })
    .where(and(eq(orders.id, order.id), eq(orders.status, order.status)))
    .returning();
  if (!row) throw new HttpError(409, 'order_changed', 'This order changed. Refresh and try again.');
  await orderEvent(tx, order.id, actorId, type, { from: order.status, to, ...meta });
  return row;
}

export async function lockOrder(tx: Tx, id: string): Promise<OrderRow> {
  const [row] = await tx.select().from(orders).where(eq(orders.id, id)).for('update');
  if (!row) throw new HttpError(404, 'order_not_found', 'No such order');
  return row;
}

async function linesOf(db: Db | Tx, orderId: string) {
  return db
    .select()
    .from(orderLines)
    .where(eq(orderLines.orderId, orderId))
    .orderBy(asc(orderLines.lineNo));
}

// ---- Views ----

async function lineRows(db: Db | Tx, orderIds: string[]) {
  if (!orderIds.length) return [];
  const lines = await db
    .select({ line: orderLines, item: items })
    .from(orderLines)
    .innerJoin(items, eq(items.id, orderLines.itemId))
    .where(inArray(orderLines.orderId, orderIds))
    .orderBy(asc(orderLines.lineNo));
  const altIds = lines.map((l) => l.line.alternateItemId).filter((x): x is string => !!x);
  const alts = altIds.length ? await db.select().from(items).where(inArray(items.id, altIds)) : [];
  return lines.map((l) => ({
    ...l,
    alt: alts.find((a) => a.id === l.line.alternateItemId) ?? null,
  }));
}

function lineView(line: LineRow, item: ItemRow, alt: ItemRow | null): OrderLine {
  return {
    id: line.id,
    lineNo: line.lineNo,
    itemId: line.itemId,
    itemNo: line.itemNo,
    nameEn: line.nameEn,
    nameTe: line.nameTe,
    packDesc: line.packDesc,
    imageUrl: itemImageUrl(item),
    qty: line.qty,
    unitPricePaise: line.unitPricePaise,
    status: line.status,
    pickedQty: line.pickedQty,
    replacesLineId: line.replacesLineId,
    alternate:
      alt && line.alternateQty && line.alternatePricePaise
        ? {
            itemId: alt.id,
            nameEn: alt.nameEn,
            nameTe: alt.nameTe,
            packDesc: alt.packDesc,
            unitPricePaise: line.alternatePricePaise,
            qty: line.alternateQty,
          }
        : null,
  };
}

async function feeState(db: Db | Tx, order: OrderRow): Promise<FeeState> {
  const pays = await db
    .select()
    .from(feePayments)
    .where(eq(feePayments.orderId, order.id))
    .orderBy(desc(feePayments.createdAt));
  const captured = pays.find((p) => p.status === 'captured');
  const base = { amountPaise: order.feePaise, checkout: null };
  if (!captured) {
    const open = pays.find((p) => p.status === 'created');
    const fresh =
      order.status === 'fee_pending' &&
      open &&
      Date.now() - open.createdAt.getTime() < CHECKOUT_REUSE_MINUTES * 60_000;
    return {
      ...base,
      status: 'unpaid',
      checkout: fresh
        ? { provider: open.provider, checkoutId: open.checkoutId, url: open.checkoutUrl }
        : null,
    };
  }
  const [refund] = await db
    .select()
    .from(feeRefunds)
    .where(eq(feeRefunds.feePaymentId, captured.id))
    .orderBy(desc(feeRefunds.createdAt))
    .limit(1);
  if (refund?.status === 'processed') return { ...base, status: 'refunded' };
  if (refund?.status === 'pending') return { ...base, status: 'refund_pending' };
  if (refund?.status === 'failed') return { ...base, status: 'refund_failed' };
  return { ...base, status: order.confirmedAt ? 'kept' : 'paid' };
}

export async function billFor(db: Db | Tx, order: OrderRow, shop: ShopRow): Promise<Bill | null> {
  if (!order.billNo) return null;
  const [pay] = await db
    .select()
    .from(counterPayments)
    .where(and(eq(counterPayments.orderId, order.id), eq(counterPayments.status, 'received')));
  if (!pay) return null;
  const [licence] = await db
    .select({ no: shopLicences.licenceNo })
    .from(shopLicences)
    .where(and(eq(shopLicences.shopId, shop.id), eq(shopLicences.status, 'verified')))
    .orderBy(desc(shopLicences.validTo))
    .limit(1);
  const picked = (await linesOf(db, order.id)).filter((l) => l.status === 'picked');
  return {
    billNo: order.billNo,
    issuedAt: (order.completedAt ?? pay.receivedAt ?? new Date()).toISOString(),
    orderCode: formatOrderCode(order.code),
    shop: {
      name: shop.name,
      address: shop.address,
      licenceNo: licence?.no ?? null,
      phone: shop.phoneE164,
    },
    lines: picked.map((l) => ({
      nameEn: l.nameEn,
      qty: l.pickedQty,
      unitPricePaise: l.unitPricePaise,
      totalPaise: l.pickedQty * l.unitPricePaise,
    })),
    totalPaise: order.finalTotalPaise ?? 0,
    payment: {
      method: pay.method,
      reference: pay.method === 'upi' ? (pay.utr ?? pay.reference) : pay.reference,
    },
  };
}

export async function customerOrderView(db: Db | Tx, order: OrderRow): Promise<CustomerOrder> {
  const [shop] = await db.select().from(shops).where(eq(shops.id, order.shopId));
  const [cluster] = shop?.clusterId
    ? await db.select().from(clusters).where(eq(clusters.id, shop.clusterId))
    : [];
  const rows = await lineRows(db, [order.id]);
  return {
    id: order.id,
    code: formatOrderCode(order.code),
    status: order.status,
    shop: {
      shortCode: shop!.shortCode,
      name: shop!.name,
      address: cluster?.address ?? shop!.address,
      lat: cluster?.lat ?? shop!.lat,
      lng: cluster?.lng ?? shop!.lng,
      pickupNotes: cluster?.gateNotes ?? null,
    },
    lines: rows.map((r) => lineView(r.line, r.item, r.alt)),
    estimatedTotalPaise: order.estimatedTotalPaise,
    finalTotalPaise: order.finalTotalPaise,
    packNo: order.packNo,
    fee: await feeState(db, order),
    placedAt: iso(order.feePaidAt),
    confirmBy: iso(order.confirmBy),
    confirmedAt: iso(order.confirmedAt),
    packedAt: iso(order.packedAt),
    completedAt: iso(order.completedAt),
    cancelReason: order.cancelReason,
    bill: await billFor(db, order, shop!),
  };
}

export async function staffOrderView(db: Db | Tx, order: OrderRow): Promise<StaffOrder> {
  const [shop] = await db.select().from(shops).where(eq(shops.id, order.shopId));
  const [customer] = await db
    .select({ phone: users.phoneE164 })
    .from(users)
    .where(eq(users.id, order.userId));
  const rows = await lineRows(db, [order.id]);
  const [pay] = await db
    .select()
    .from(counterPayments)
    .where(eq(counterPayments.orderId, order.id))
    .orderBy(desc(counterPayments.createdAt))
    .limit(1);
  const lines: StaffOrderLine[] = rows.map((r) => ({
    ...lineView(r.line, r.item, r.alt),
    barcode: r.item.barcode,
    rackCode: r.item.rackCode,
    stockQty: r.item.stockQty,
  }));
  return {
    id: order.id,
    code: formatOrderCode(order.code),
    status: order.status,
    customer: staffPhoneMask(customer?.phone ?? ''),
    lines,
    estimatedTotalPaise: order.estimatedTotalPaise,
    finalTotalPaise: order.finalTotalPaise,
    packNo: order.packNo,
    placedAt: iso(order.feePaidAt),
    confirmBy: iso(order.confirmBy),
    confirmedAt: iso(order.confirmedAt),
    packedAt: iso(order.packedAt),
    completedAt: iso(order.completedAt),
    packMatched: !!order.packMatchedAt,
    counterPayment: pay
      ? {
          id: pay.id,
          method: pay.method,
          status: pay.status,
          amountPaise: pay.amountPaise,
          reference: pay.method === 'upi' ? (pay.utr ?? pay.reference) : pay.reference,
          payUrl: pay.status === 'pending' ? pay.payUrl : null,
          changePaise:
            pay.method === 'cash' && pay.receivedPaise != null
              ? pay.receivedPaise - pay.amountPaise
              : null,
        }
      : null,
    bill: await billFor(db, order, shop!),
  };
}

export async function customerOrderSummaries(
  db: Db,
  userId: string,
): Promise<CustomerOrderSummary[]> {
  const rows = await db
    .select({
      o: orders,
      shopName: shops.name,
      lineCount: sql<number>`(select count(*)::int from order_lines l where l.order_id = ${orders.id} and l.status not in ('replaced','removed'))`,
    })
    .from(orders)
    .innerJoin(shops, eq(shops.id, orders.shopId))
    .where(eq(orders.userId, userId))
    .orderBy(desc(orders.createdAt))
    .limit(50);
  return rows.map(({ o, shopName, lineCount }) => ({
    id: o.id,
    code: formatOrderCode(o.code),
    status: o.status,
    estimatedTotalPaise: o.estimatedTotalPaise,
    finalTotalPaise: o.finalTotalPaise,
    placedAt: iso(o.feePaidAt),
    packNo: o.packNo,
    shopName,
    lineCount,
  }));
}

export async function staffOrderSummaries(
  db: Db,
  shopId: string,
  statuses: readonly OrderStatus[],
): Promise<StaffOrderSummary[]> {
  const rows = await db
    .select({
      o: orders,
      phone: users.phoneE164,
      lineCount: sql<number>`(select count(*)::int from order_lines l where l.order_id = ${orders.id} and l.status not in ('replaced','removed'))`,
      openDecisions: sql<number>`(select count(*)::int from order_lines l where l.order_id = ${orders.id} and l.status in ('out_of_stock','alternate_proposed'))`,
    })
    .from(orders)
    .innerJoin(users, eq(users.id, orders.userId))
    .where(and(eq(orders.shopId, shopId), inArray(orders.status, [...statuses])))
    .orderBy(asc(orders.feePaidAt))
    .limit(200);
  return rows.map(({ o, phone, lineCount, openDecisions }) => ({
    id: o.id,
    code: formatOrderCode(o.code),
    status: o.status,
    customer: staffPhoneMask(phone),
    estimatedTotalPaise: o.estimatedTotalPaise,
    packNo: o.packNo,
    placedAt: iso(o.feePaidAt),
    confirmBy: iso(o.confirmBy),
    lineCount,
    openDecisions,
  }));
}

// ---- Customer: place, pay fee, cancel, decide ----

function assertOrderingEnabled() {
  if (!env.orderingEnabled()) {
    throw new HttpError(403, 'ordering_disabled', 'Online ordering is not available yet');
  }
}

/** Prices the order from the catalogue (G11) and opens the ₹30 fee payment. */
export async function placeOrder(
  db: Db,
  userId: string,
  input: PlaceOrder,
): Promise<CustomerOrder> {
  assertOrderingEnabled();
  const [shop] = await db
    .select({ id: visibleShops.id })
    .from(visibleShops)
    .where(eq(visibleShops.shortCode, input.shopCode));
  if (!shop) throw new HttpError(404, 'shop_not_found', 'This shop is not listed');

  const rows = await db
    .select({ item: items, banned: categories.isBanned })
    .from(items)
    .innerJoin(categories, eq(categories.id, items.categoryId))
    .where(
      and(
        eq(items.shopId, shop.id),
        inArray(
          items.id,
          input.lines.map((l) => l.itemId),
        ),
      ),
    );
  const now = new Date();
  const priced = input.lines.map((l) => {
    const row = rows.find((r) => r.item.id === l.itemId);
    if (!row || !row.item.isActive || row.banned) {
      throw new HttpError(409, 'item_unavailable', 'An item in your list is no longer available');
    }
    if (row.item.isSoldOut || row.item.stockQty === 0) {
      throw new HttpError(409, 'item_sold_out', `${row.item.nameEn} is sold out`);
    }
    if (row.item.stockQty != null && l.qty > row.item.stockQty) {
      throw new HttpError(
        409,
        'not_enough_stock',
        `Only ${row.item.stockQty} of ${row.item.nameEn} left`,
      );
    }
    return { item: row.item, qty: l.qty, unit: effectivePrice(row.item, now) };
  });
  const estimated = priced.reduce((n, p) => n + p.unit * p.qty, 0);

  let order: OrderRow | undefined;
  for (let attempt = 0; !order; attempt++) {
    try {
      order = await db.transaction(async (tx) => {
        const [o] = await tx
          .insert(orders)
          .values({
            code: newOrderCode(),
            userId,
            shopId: shop.id,
            feePaise: PLATFORM_FEE_PAISE,
            estimatedTotalPaise: estimated,
          })
          .returning();
        await tx.insert(orderLines).values(
          priced.map((p, i) => ({
            orderId: o!.id,
            lineNo: i + 1,
            itemId: p.item.id,
            itemNo: p.item.itemNo,
            nameEn: p.item.nameEn,
            nameTe: p.item.nameTe,
            packDesc: p.item.packDesc,
            unitPricePaise: p.unit,
            qty: p.qty,
          })),
        );
        await orderEvent(tx, o!.id, userId, 'created', { lines: priced.length, estimated });
        return o!;
      });
    } catch (err) {
      const e = pgError(err);
      if (e?.code === '23505' && e.constraint === 'orders_code_unique' && attempt < 3) continue;
      throw err;
    }
  }
  return startFeePayment(db, userId, order.id);
}

async function ownOrder(db: Db | Tx, userId: string, orderId: string): Promise<OrderRow> {
  const [o] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.userId, userId)));
  if (!o) throw new HttpError(404, 'order_not_found', 'No such order');
  return o;
}

export async function getCustomerOrder(db: Db, userId: string, orderId: string) {
  return customerOrderView(db, await ownOrder(db, userId, orderId));
}

/** Opens (or reuses) the ₹30 fee checkout for an unpaid order. */
export async function startFeePayment(
  db: Db,
  userId: string,
  orderId: string,
): Promise<CustomerOrder> {
  assertOrderingEnabled();
  const order = await ownOrder(db, userId, orderId);
  if (order.status !== 'fee_pending') return customerOrderView(db, order);
  const state = await feeState(db, order);
  if (state.checkout) return customerOrderView(db, order);

  const provider = activeProvider();
  const [{ n } = { n: 0 }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(feePayments)
    .where(eq(feePayments.orderId, order.id));
  const idempotencyKey = `fee:${order.id}:${n + 1}`;
  const checkout = await provider.createCheckout({
    idempotencyKey,
    amountPaise: order.feePaise,
    reference: formatOrderCode(order.code),
  });
  const [pay] = await db
    .insert(feePayments)
    .values({
      orderId: order.id,
      provider: provider.name,
      checkoutId: checkout.checkoutId,
      checkoutUrl: checkout.url,
      amountPaise: order.feePaise,
      idempotencyKey,
    })
    .returning();
  await orderEvent(db, order.id, userId, 'fee_checkout', {
    provider: provider.name,
    feePaymentId: pay!.id,
  });
  return customerOrderView(db, order);
}

export async function cancelByCustomer(db: Db, userId: string, orderId: string, reason?: string) {
  const cancelled = await db.transaction(async (tx) => {
    const order = await lockOrder(tx, (await ownOrder(tx, userId, orderId)).id);
    return transition(
      tx,
      order,
      'cancelled',
      { cancelledAt: new Date(), cancelReason: reason || 'Cancelled by customer' },
      userId,
      'cancelled_by_customer',
    );
  });
  if (feeOutcome(cancelled) === 'refund') {
    await refundFee(db, cancelled.id, userId, 'Cancelled before the merchant confirmed');
  }
  return customerOrderView(db, cancelled);
}

/** Customer answers an out-of-stock or alternative question. Silence is never approval. */
export async function customerDecision(
  db: Db,
  userId: string,
  orderId: string,
  input: CustomerDecision,
) {
  let refundAfter = false;
  const result = await db.transaction(async (tx) => {
    let order = await lockOrder(tx, (await ownOrder(tx, userId, orderId)).id);
    if (order.status !== 'awaiting_customer') {
      throw new HttpError(409, 'no_decision_needed', 'Nothing is waiting for your answer');
    }
    const lines = await linesOf(tx, order.id);
    const line = lines.find((l) => l.id === input.lineId);
    if (!line) throw new HttpError(404, 'line_not_found', 'No such item in this order');

    if (line.status === 'out_of_stock') {
      if (input.decision !== 'remove') {
        throw new HttpError(400, 'invalid_decision', 'This item can only be removed');
      }
      await tx
        .update(orderLines)
        .set({ status: 'removed', decidedAt: new Date() })
        .where(eq(orderLines.id, line.id));
    } else if (line.status === 'alternate_proposed') {
      if (input.decision === 'accept') {
        const [alt] = await tx.select().from(items).where(eq(items.id, line.alternateItemId!));
        await tx
          .update(orderLines)
          .set({ status: 'replaced', decidedAt: new Date() })
          .where(eq(orderLines.id, line.id));
        await tx.insert(orderLines).values({
          orderId: order.id,
          lineNo: Math.max(...lines.map((l) => l.lineNo)) + 1,
          itemId: alt!.id,
          itemNo: alt!.itemNo,
          nameEn: alt!.nameEn,
          nameTe: alt!.nameTe,
          packDesc: alt!.packDesc,
          unitPricePaise: line.alternatePricePaise!,
          qty: line.alternateQty!,
          replacesLineId: line.id,
        });
      } else {
        await tx
          .update(orderLines)
          .set({ status: 'removed', decidedAt: new Date() })
          .where(eq(orderLines.id, line.id));
      }
    } else {
      throw new HttpError(409, 'no_decision_needed', 'This item does not need an answer');
    }
    await orderEvent(tx, order.id, userId, 'customer_decision', {
      lineId: line.id,
      decision: input.decision,
    });

    const after = await linesOf(tx, order.id);
    if (!needsCustomer(after)) {
      const anythingLeft = after.some((l) => l.status === 'picked' || l.status === 'pending');
      if (anythingLeft) {
        order = await transition(tx, order, 'packing', {}, userId, 'decisions_done');
      } else {
        // Merchant could supply nothing: the order ends and the fee is refunded.
        order = await transition(
          tx,
          order,
          'cancelled',
          { cancelledAt: new Date(), cancelReason: 'None of the items were available' },
          null,
          'nothing_available',
        );
        refundAfter = true;
      }
    }
    return order;
  });
  if (refundAfter) await refundFee(db, result.id, null, 'Merchant could not supply any item');
  return customerOrderView(db, result);
}

/** New pickup QR for a packed order; any earlier one stops working. */
export async function rotateCustomerQr(db: Db, userId: string, orderId: string) {
  const order = await ownOrder(db, userId, orderId);
  if (order.status !== 'packed') {
    throw new HttpError(409, 'not_packed', 'Your pickup QR appears when the order is packed');
  }
  const secret = newQrSecret();
  await db
    .update(orders)
    .set({ customerQrHash: hashSecret(secret) })
    .where(and(eq(orders.id, order.id), eq(orders.status, 'packed')));
  await orderEvent(db, order.id, userId, 'pickup_qr_shown');
  return { orderId: order.id, qr: encodeOrderQr('customer', secret) };
}

// ---- Platform fee: provider events and refunds ----

export type FeeEventOutcome =
  | 'duplicate'
  | 'placed'
  | 'captured_order_closed'
  | 'already_captured'
  | 'amount_mismatch'
  | 'unknown_checkout'
  | 'payment_failed'
  | 'ignored'
  | 'refund_processed'
  | 'refund_failed'
  | 'unknown_refund';

/** Applies one verified provider event exactly once (event id recorded in the same tx). */
export async function applyFeeEvent(
  db: Db,
  provider: string,
  event: ProviderEvent,
  rawBody: string,
  now = new Date(),
): Promise<{ outcome: FeeEventOutcome; orderId: string | null }> {
  return db.transaction(async (tx) => {
    const [recorded] = await tx
      .insert(feePaymentEvents)
      .values({
        provider,
        eventId: event.id,
        type: event.type,
        payloadSha256: sha256(rawBody),
        outcome: 'processing',
      })
      .onConflictDoNothing()
      .returning({ id: feePaymentEvents.id });
    if (!recorded) return { outcome: 'duplicate' as const, orderId: null };
    const result = await applyFeeEventInTx(tx, provider, event, now);
    await tx
      .update(feePaymentEvents)
      .set({ outcome: result.outcome })
      .where(eq(feePaymentEvents.id, recorded.id));
    await audit(tx, {
      actorUserId: null,
      action: `fee.${event.type}`,
      entity: 'fee_payment_event',
      entityId: recorded.id,
      meta: { provider, eventId: event.id, ...result },
    });
    return result;
  });
}

async function applyFeeEventInTx(
  tx: Tx,
  provider: string,
  event: ProviderEvent,
  now: Date,
): Promise<{ outcome: FeeEventOutcome; orderId: string | null }> {
  if (event.type === 'payment.captured' || event.type === 'payment.failed') {
    const [pay] = await tx
      .select()
      .from(feePayments)
      .where(and(eq(feePayments.provider, provider), eq(feePayments.checkoutId, event.checkoutId)))
      .for('update');
    if (!pay) return { outcome: 'unknown_checkout', orderId: null };
    if (event.amountPaise !== pay.amountPaise)
      return { outcome: 'amount_mismatch', orderId: pay.orderId };
    if (event.type === 'payment.failed') {
      if (pay.status !== 'created') return { outcome: 'ignored', orderId: pay.orderId };
      await tx
        .update(feePayments)
        .set({ status: 'failed', failedAt: now })
        .where(eq(feePayments.id, pay.id));
      return { outcome: 'payment_failed', orderId: pay.orderId };
    }
    if (pay.status === 'captured') return { outcome: 'already_captured', orderId: pay.orderId };
    // A late capture after a "failed" event still means the money arrived.
    await tx
      .update(feePayments)
      .set({ status: 'captured', providerPaymentId: event.paymentId, capturedAt: now })
      .where(eq(feePayments.id, pay.id));
    const order = await lockOrder(tx, pay.orderId);
    if (order.status !== 'fee_pending') {
      return { outcome: 'captured_order_closed', orderId: order.id };
    }
    await transition(
      tx,
      order,
      'placed',
      { feePaidAt: now, confirmBy: confirmBy(now) },
      null,
      'fee_paid',
      { provider },
    );
    return { outcome: 'placed', orderId: order.id };
  }

  const [hit] = await tx
    .select({ r: feeRefunds, p: feePayments })
    .from(feeRefunds)
    .innerJoin(feePayments, eq(feePayments.id, feeRefunds.feePaymentId))
    .where(and(eq(feePayments.provider, provider), eq(feeRefunds.providerRefundId, event.refundId)))
    .for('update');
  if (!hit) return { outcome: 'unknown_refund', orderId: null };
  if (hit.r.status !== 'pending') return { outcome: 'ignored', orderId: hit.p.orderId };
  const processed = event.type === 'refund.processed';
  await tx
    .update(feeRefunds)
    .set(processed ? { status: 'processed', processedAt: now } : { status: 'failed' })
    .where(eq(feeRefunds.id, hit.r.id));
  await orderEvent(tx, hit.p.orderId, null, processed ? 'fee_refunded' : 'fee_refund_failed');
  return { outcome: processed ? 'refund_processed' : 'refund_failed', orderId: hit.p.orderId };
}

/** Verifies a provider webhook's signature on the raw body, then applies it once. */
export async function processFeeWebhook(
  db: Db,
  providerName: string | undefined,
  rawBody: string,
  headers: HeaderReader,
) {
  const provider = providerByName(providerName);
  let event: ProviderEvent;
  try {
    event = provider.verifyWebhook(rawBody, headers);
  } catch (err) {
    if (err instanceof WebhookSignatureError) {
      throw new HttpError(401, 'bad_signature', 'Invalid webhook signature');
    }
    throw err;
  }
  const result = await applyFeeEvent(db, provider.name, event, rawBody);
  // Paid after the order closed (e.g. cancelled while paying): give it back.
  if (result.outcome === 'captured_order_closed' && result.orderId) {
    await refundFee(db, result.orderId, null, 'Fee paid after the order was closed', provider);
  }
  return result.outcome;
}

/**
 * Full refund of the captured fee. Idempotent: an existing pending/processed
 * refund is returned instead of creating another.
 */
export async function refundFee(
  db: Db,
  orderId: string,
  actorId: string | null,
  reason: string,
  provider: PaymentProvider = activeProvider(),
) {
  const prepared = await db.transaction(async (tx) => {
    const [pay] = await tx
      .select()
      .from(feePayments)
      .where(and(eq(feePayments.orderId, orderId), eq(feePayments.status, 'captured')))
      .orderBy(desc(feePayments.capturedAt))
      .limit(1)
      .for('update');
    if (!pay?.providerPaymentId) return null;
    const existing = await tx.select().from(feeRefunds).where(eq(feeRefunds.feePaymentId, pay.id));
    const live = existing.find((r) => r.status === 'pending' || r.status === 'processed');
    if (live) return { refund: live, pay, created: false };
    const [refund] = await tx
      .insert(feeRefunds)
      .values({
        feePaymentId: pay.id,
        amountPaise: pay.amountPaise,
        idempotencyKey: `fee-refund:${pay.id}:${existing.length + 1}`,
        reason,
        requestedBy: actorId,
      })
      .returning();
    await orderEvent(tx, orderId, actorId, 'fee_refund_requested', { reason });
    return { refund: refund!, pay, created: true };
  });
  if (!prepared || !prepared.created) return prepared?.refund ?? null;
  if (prepared.pay.provider !== provider.name) provider = providerByName(prepared.pay.provider);

  const { refundId } = await provider.refund({
    paymentId: prepared.pay.providerPaymentId!,
    amountPaise: prepared.refund.amountPaise,
    idempotencyKey: prepared.refund.idempotencyKey,
  });
  await db
    .update(feeRefunds)
    .set({ providerRefundId: refundId })
    .where(eq(feeRefunds.id, prepared.refund.id));
  // The mock provider settles at once through the same signed-webhook path.
  if (provider.name === mockProvider.name) {
    const signed = signMockEvent({
      id: mockId('mock_ev'),
      type: 'refund.processed',
      refundId,
      paymentId: prepared.pay.providerPaymentId!,
      amountPaise: prepared.refund.amountPaise,
    });
    await processFeeWebhook(db, provider.name, signed.rawBody, signed.headers);
  }
  return prepared.refund;
}

// ---- Merchant: confirm / reject ----

export async function shopOrder(db: Db | Tx, shopId: string, orderId: string): Promise<OrderRow> {
  const [o] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.shopId, shopId)));
  // fee_pending orders are invisible to merchants.
  if (!o || o.status === 'fee_pending')
    throw new HttpError(404, 'order_not_found', 'No such order');
  return o;
}

export async function confirmOrder(db: Db, shopId: string, actorId: string, orderId: string) {
  const row = await db.transaction(async (tx) => {
    const order = await lockOrder(tx, (await shopOrder(tx, shopId, orderId)).id);
    if (order.status === 'placed' && order.confirmBy && order.confirmBy <= new Date()) {
      throw new HttpError(409, 'confirm_window_passed', 'The 3-day window to confirm has passed');
    }
    return transition(
      tx,
      order,
      'confirmed',
      { confirmedAt: new Date(), confirmedBy: actorId },
      actorId,
      'confirmed',
    );
  });
  return staffOrderView(db, row);
}

export async function rejectOrder(
  db: Db,
  shopId: string,
  actorId: string,
  orderId: string,
  reason: string,
) {
  const row = await db.transaction(async (tx) => {
    const order = await lockOrder(tx, (await shopOrder(tx, shopId, orderId)).id);
    return transition(
      tx,
      order,
      'rejected',
      { cancelledAt: new Date(), cancelReason: reason },
      actorId,
      'rejected',
      { reason },
    );
  });
  await refundFee(db, row.id, actorId, `Merchant rejected: ${reason}`);
  return staffOrderView(db, row);
}

/** Hourly job: orders not confirmed within the window expire and the fee is refunded. */
export async function expireUnconfirmed(db: Db, now = new Date()): Promise<number> {
  const due = await db
    .select({ id: orders.id })
    .from(orders)
    .where(
      and(
        eq(orders.status, 'placed'),
        sql`${orders.confirmBy} <= ${now.toISOString()}::timestamptz`,
      ),
    );
  let n = 0;
  for (const { id } of due) {
    const done = await db.transaction(async (tx) => {
      const order = await lockOrder(tx, id);
      if (order.status !== 'placed' || !order.confirmBy || order.confirmBy > now) return false;
      await transition(
        tx,
        order,
        'expired',
        { cancelledAt: now, cancelReason: 'Not confirmed by the merchant within 3 days' },
        null,
        'expired',
      );
      return true;
    });
    if (done) {
      await refundFee(db, id, null, 'Not confirmed within 3 days');
      n++;
    }
  }
  return n;
}

// ---- Packer ----

export async function startPacking(db: Db, shopId: string, actorId: string, orderId: string) {
  const row = await db.transaction(async (tx) => {
    const order = await lockOrder(tx, (await shopOrder(tx, shopId, orderId)).id);
    if (order.status === 'packing') return order;
    return transition(
      tx,
      order,
      'packing',
      { packingStartedAt: new Date() },
      actorId,
      'packing_started',
    );
  });
  return staffOrderView(db, row);
}

async function packingOrder(tx: Tx, shopId: string, orderId: string) {
  const order = await lockOrder(tx, (await shopOrder(tx, shopId, orderId)).id);
  if (order.status !== 'packing') {
    throw new HttpError(409, 'not_packing', 'Start packing this order first');
  }
  return order;
}

/** Takes `n` units from tracked stock atomically; untracked stock always succeeds. */
async function takeStock(tx: Tx, itemId: string, n: number): Promise<boolean> {
  const [row] = await tx
    .update(items)
    .set({
      stockQty: sql`case when ${items.stockQty} is null then null else ${items.stockQty} - ${n} end`,
    })
    .where(and(eq(items.id, itemId), sql`(${items.stockQty} is null or ${items.stockQty} >= ${n})`))
    .returning({ id: items.id });
  return !!row;
}

/** Packer scans one unit's barcode; it must belong to a line still to be picked. */
export async function scanItem(
  db: Db,
  shopId: string,
  actorId: string,
  orderId: string,
  barcode: string,
) {
  const row = await db.transaction(async (tx) => {
    const order = await packingOrder(tx, shopId, orderId);
    const [item] = await tx
      .select()
      .from(items)
      .where(and(eq(items.shopId, shopId), eq(items.barcode, barcode)));
    if (!item) throw new HttpError(404, 'unknown_barcode', 'This barcode is not in your catalogue');
    const lines = await linesOf(tx, order.id);
    const forItem = lines.filter((l) => l.itemId === item.id);
    const line = forItem.find((l) => l.status === 'pending' && l.pickedQty < l.qty);
    if (!line) {
      if (forItem.some((l) => l.status === 'picked')) {
        throw new HttpError(409, 'already_picked', `${item.nameEn}: all units already scanned`);
      }
      throw new HttpError(409, 'not_in_order', `${item.nameEn} is not in this order`);
    }
    if (!(await takeStock(tx, item.id, 1))) {
      throw new HttpError(409, 'no_stock_left', `${item.nameEn}: stock shows none left`);
    }
    const picked = line.pickedQty + 1;
    await tx
      .update(orderLines)
      .set({ pickedQty: picked, status: picked === line.qty ? 'picked' : 'pending' })
      .where(eq(orderLines.id, line.id));
    await orderEvent(tx, order.id, actorId, 'item_scanned', { lineId: line.id, barcode });
    return order;
  });
  return staffOrderView(db, row);
}

/** For items without a barcode: the packer confirms the line by hand. */
export async function pickByHand(
  db: Db,
  shopId: string,
  actorId: string,
  orderId: string,
  lineId: string,
) {
  const row = await db.transaction(async (tx) => {
    const order = await packingOrder(tx, shopId, orderId);
    const [hit] = await tx
      .select({ line: orderLines, item: items })
      .from(orderLines)
      .innerJoin(items, eq(items.id, orderLines.itemId))
      .where(and(eq(orderLines.id, lineId), eq(orderLines.orderId, order.id)));
    if (!hit || hit.line.status !== 'pending') {
      throw new HttpError(409, 'line_not_pending', 'This item is not waiting to be picked');
    }
    if (hit.item.barcode) {
      throw new HttpError(409, 'scan_required', 'Scan the barcode for this item');
    }
    const remaining = hit.line.qty - hit.line.pickedQty;
    if (!(await takeStock(tx, hit.item.id, remaining))) {
      throw new HttpError(409, 'no_stock_left', `${hit.item.nameEn}: stock shows too few left`);
    }
    await tx
      .update(orderLines)
      .set({ pickedQty: hit.line.qty, status: 'picked' })
      .where(eq(orderLines.id, lineId));
    await orderEvent(tx, order.id, actorId, 'item_picked_by_hand', { lineId });
    return order;
  });
  return staffOrderView(db, row);
}

/**
 * Splits off what is already picked so a decision only covers the missing
 * units: returns the line that now holds the unpicked remainder.
 */
async function splitPicked(tx: Tx, order: OrderRow, line: LineRow, lines: LineRow[]) {
  if (line.pickedQty === 0) return line;
  const remainder = line.qty - line.pickedQty;
  await tx
    .update(orderLines)
    .set({ qty: line.pickedQty, status: 'picked' })
    .where(eq(orderLines.id, line.id));
  const [rest] = await tx
    .insert(orderLines)
    .values({
      orderId: order.id,
      lineNo: Math.max(...lines.map((l) => l.lineNo)) + 1,
      itemId: line.itemId,
      itemNo: line.itemNo,
      nameEn: line.nameEn,
      nameTe: line.nameTe,
      packDesc: line.packDesc,
      unitPricePaise: line.unitPricePaise,
      qty: remainder,
    })
    .returning();
  return rest!;
}

async function pendingLine(tx: Tx, order: OrderRow, lineId: string) {
  const lines = await linesOf(tx, order.id);
  const line = lines.find((l) => l.id === lineId);
  if (!line || line.status !== 'pending') {
    throw new HttpError(409, 'line_not_pending', 'This item is not waiting to be picked');
  }
  return { line, lines };
}

export async function markOutOfStock(
  db: Db,
  shopId: string,
  actorId: string,
  orderId: string,
  lineId: string,
) {
  const row = await db.transaction(async (tx) => {
    let order = await packingOrder(tx, shopId, orderId);
    const { line, lines } = await pendingLine(tx, order, lineId);
    const target = await splitPicked(tx, order, line, lines);
    await tx.update(orderLines).set({ status: 'out_of_stock' }).where(eq(orderLines.id, target.id));
    await tx.update(items).set({ isSoldOut: true }).where(eq(items.id, line.itemId));
    order = await transition(tx, order, 'awaiting_customer', {}, actorId, 'out_of_stock', {
      lineId: target.id,
    });
    return order;
  });
  return staffOrderView(db, row);
}

export async function proposeAlternate(
  db: Db,
  shopId: string,
  actorId: string,
  orderId: string,
  input: ProposeAlternate,
) {
  const row = await db.transaction(async (tx) => {
    let order = await packingOrder(tx, shopId, orderId);
    const { line, lines } = await pendingLine(tx, order, input.lineId);
    const [alt] = await tx
      .select({ item: items, banned: categories.isBanned })
      .from(items)
      .innerJoin(categories, eq(categories.id, items.categoryId))
      .where(and(eq(items.id, input.itemId), eq(items.shopId, shopId)));
    if (!alt || !alt.item.isActive || alt.banned || alt.item.isSoldOut || alt.item.stockQty === 0) {
      throw new HttpError(409, 'alternate_unavailable', 'That alternative is not available');
    }
    if (alt.item.id === line.itemId) {
      throw new HttpError(400, 'same_item', 'Pick a different item as the alternative');
    }
    const target = await splitPicked(tx, order, line, lines);
    await tx
      .update(orderLines)
      .set({
        status: 'alternate_proposed',
        alternateItemId: alt.item.id,
        alternateQty: input.qty,
        alternatePricePaise: effectivePrice(alt.item),
      })
      .where(eq(orderLines.id, target.id));
    order = await transition(tx, order, 'awaiting_customer', {}, actorId, 'alternate_proposed', {
      lineId: target.id,
      itemId: alt.item.id,
      qty: input.qty,
    });
    return order;
  });
  return staffOrderView(db, row);
}

async function issueSticker(tx: Tx, order: OrderRow): Promise<PackSticker> {
  const secret = newQrSecret();
  await tx
    .update(orders)
    .set({ packQrHash: hashSecret(secret) })
    .where(eq(orders.id, order.id));
  const lines = await linesOf(tx, order.id);
  return {
    orderId: order.id,
    code: formatOrderCode(order.code),
    packNo: order.packNo!,
    qr: encodeOrderQr('pack', secret),
    itemCount: lines.filter((l) => l.status === 'picked').reduce((n, l) => n + l.pickedQty, 0),
  };
}

/** All lines resolved → pack number, final total and the pack sticker QR. */
export async function finishPacking(db: Db, shopId: string, actorId: string, orderId: string) {
  return db.transaction(async (tx) => {
    const order = await packingOrder(tx, shopId, orderId);
    const lines = await linesOf(tx, order.id);
    if (!readyToPack(lines)) {
      throw new HttpError(409, 'not_ready', 'Scan or resolve every item before packing');
    }
    const day = istDate();
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`pack:${shopId}:${day}`}))`);
    const [{ last } = { last: 0 }] = await tx
      .select({ last: max(orders.packNo) })
      .from(orders)
      .where(and(eq(orders.shopId, shopId), eq(orders.packDay, day)));
    const packed = await transition(
      tx,
      order,
      'packed',
      {
        packNo: (last ?? 0) + 1,
        packDay: day,
        finalTotalPaise: finalTotal(lines),
        packedAt: new Date(),
        packedBy: actorId,
      },
      actorId,
      'packed',
    );
    return issueSticker(tx, packed);
  });
}

/** A new sticker for a packed order; the old sticker stops matching. */
export async function reprintSticker(db: Db, shopId: string, actorId: string, orderId: string) {
  return db.transaction(async (tx) => {
    const order = await lockOrder(tx, (await shopOrder(tx, shopId, orderId)).id);
    if (order.status !== 'packed')
      throw new HttpError(409, 'not_packed', 'This order is not packed');
    await orderEvent(tx, order.id, actorId, 'sticker_reprinted');
    return issueSticker(tx, order);
  });
}
