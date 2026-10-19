// Express Pickup counter (SPEC_V3 §1 step 6, §7). The cashier scans the
// customer's pickup QR, then the pack sticker; payment goes to the MERCHANT by
// their own YouPI-PG UPI, card machine or cash. Then the bill is issued.
import { and, eq, gte, sql } from 'drizzle-orm';
import { formatOrderCode, parseOrderQr } from '@pataka/shared';
import type { Db } from '../db/client';
import {
  counterPaymentEvents,
  counterPayments,
  merchantPaymentSettings,
  orderEvents,
  orders,
  shopCounters,
  shops,
} from '../db/schema';
import { env } from './env';
import { HttpError } from './errors';
import {
  hashSecret,
  lockOrder,
  orderEvent,
  sha256,
  shopOrder,
  staffOrderView,
  transition,
  type Tx,
} from './orders';
import { decryptSecret } from './secrets';
import {
  YOUPI_SIGNATURE_HEADER,
  createYoupiPayment,
  getYoupiStatus,
  verifyYoupiSignature,
  youpiWebhookSchema,
  type YoupiConfig,
} from './youpi';
import type { HeaderReader } from './payments';

type ShopRow = typeof shops.$inferSelect;
type Settings = typeof merchantPaymentSettings.$inferSelect;

export const MOCK_UPI_PREFIX = 'mock-upi:';

export async function paymentSettings(db: Db | Tx, shopId: string): Promise<Settings> {
  const [row] = await db
    .select()
    .from(merchantPaymentSettings)
    .where(eq(merchantPaymentSettings.shopId, shopId));
  return (
    row ?? {
      shopId,
      youpiBaseUrl: null,
      youpiMerchantId: null,
      youpiWebhookSecretEnc: null,
      upiVpa: null,
      acceptsCard: true,
      acceptsCash: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
  );
}

const youpiConfig = (s: Settings): YoupiConfig | null =>
  s.youpiBaseUrl ? { baseUrl: s.youpiBaseUrl, merchantId: s.youpiMerchantId } : null;

/**
 * Step 1: the customer's pickup QR opens their packed order at this shop. The
 * scan is recorded; the pack can't be matched or paid for without it.
 */
export async function openByCustomerQr(db: Db, shop: ShopRow, actorId: string, qr: string) {
  const parsed = parseOrderQr(qr);
  if (!parsed) throw new HttpError(400, 'not_pickup_qr', "This isn't a Diwali Express Pickup QR");
  if (parsed.kind !== 'customer') {
    throw new HttpError(
      400,
      'scan_customer_first',
      "Scan the customer's phone QR first, then the pack",
    );
  }
  const [order] = await db
    .select({ o: orders, shopName: shops.name })
    .from(orders)
    .innerJoin(shops, eq(shops.id, orders.shopId))
    .where(eq(orders.customerQrHash, hashSecret(parsed.secret)));
  if (!order)
    throw new HttpError(
      404,
      'qr_not_found',
      'Unknown or replaced QR. Ask the customer to refresh it.',
    );
  if (order.o.shopId !== shop.id) {
    throw new HttpError(409, 'wrong_shop', `This order is for ${order.shopName}`);
  }
  if (order.o.status === 'completed')
    throw new HttpError(409, 'already_collected', 'Already collected and paid');
  if (order.o.status !== 'packed') {
    throw new HttpError(409, 'not_ready', `This order is ${order.o.status.replace('_', ' ')}`);
  }
  await orderEvent(db, order.o.id, actorId, 'customer_qr_scanned');
  return staffOrderView(db, order.o);
}

/** Step 2: the pack sticker must belong to this order. */
export async function matchPack(
  db: Db,
  shop: ShopRow,
  actorId: string,
  orderId: string,
  qr: string,
) {
  const parsed = parseOrderQr(qr);
  if (!parsed || parsed.kind !== 'pack') {
    throw new HttpError(400, 'scan_pack', 'Scan the QR sticker on the pack');
  }
  const row = await db.transaction(async (tx) => {
    const order = await lockOrder(tx, (await shopOrder(tx, shop.id, orderId)).id);
    if (order.status !== 'packed')
      throw new HttpError(409, 'not_ready', 'This order is not packed');
    const [seen] = await tx
      .select({ id: orderEvents.id })
      .from(orderEvents)
      .where(
        and(
          eq(orderEvents.orderId, order.id),
          eq(orderEvents.type, 'customer_qr_scanned'),
          gte(orderEvents.at, order.packedAt!),
        ),
      )
      .limit(1);
    if (!seen) {
      throw new HttpError(
        409,
        'scan_customer_first',
        "Scan the customer's phone QR first, then the pack",
      );
    }
    if (order.packQrHash !== hashSecret(parsed.secret)) {
      await orderEvent(tx, order.id, actorId, 'wrong_pack_scanned');
      throw new HttpError(409, 'wrong_pack', `Wrong pack — this order is pack #${order.packNo}`);
    }
    const [updated] = await tx
      .update(orders)
      .set({ packMatchedAt: new Date() })
      .where(eq(orders.id, order.id))
      .returning();
    await orderEvent(tx, order.id, actorId, 'pack_matched');
    return updated!;
  });
  return staffOrderView(db, row);
}

async function readyForPayment(tx: Tx, shopId: string, orderId: string) {
  const order = await lockOrder(tx, (await shopOrder(tx, shopId, orderId)).id);
  if (order.status === 'completed') throw new HttpError(409, 'already_collected', 'Already paid');
  if (order.status !== 'packed') throw new HttpError(409, 'not_ready', 'This order is not packed');
  if (!order.packMatchedAt)
    throw new HttpError(409, 'pack_not_matched', 'Scan the pack sticker first');
  return order;
}

async function cancelPending(tx: Tx, orderId: string) {
  await tx
    .update(counterPayments)
    .set({ status: 'cancelled' })
    .where(and(eq(counterPayments.orderId, orderId), eq(counterPayments.status, 'pending')));
}

/** Records the payment as received, completes the order and issues the bill — once. */
async function receive(
  tx: Tx,
  paymentId: string,
  actorId: string | null,
  extra: Partial<typeof counterPayments.$inferInsert> = {},
) {
  const [pay] = await tx
    .select()
    .from(counterPayments)
    .where(eq(counterPayments.id, paymentId))
    .for('update');
  if (!pay) throw new HttpError(404, 'payment_not_found', 'No such payment');
  const order = await lockOrder(tx, pay.orderId);
  if (pay.status === 'received' || order.status === 'completed') return order;
  if (pay.status !== 'pending')
    throw new HttpError(409, 'payment_closed', 'This payment was cancelled');
  await tx
    .update(counterPayments)
    .set({ ...extra, status: 'received', receivedAt: new Date() })
    .where(eq(counterPayments.id, pay.id));
  const [counter] = await tx
    .insert(shopCounters)
    .values({ shopId: order.shopId, lastBillNo: 1 })
    .onConflictDoUpdate({
      target: shopCounters.shopId,
      set: { lastBillNo: sql`${shopCounters.lastBillNo} + 1` },
    })
    .returning({ n: shopCounters.lastBillNo });
  const [shop] = await tx
    .select({ code: shops.shortCode })
    .from(shops)
    .where(eq(shops.id, order.shopId));
  await orderEvent(tx, order.id, actorId, 'paid', {
    method: pay.method,
    amountPaise: pay.amountPaise,
  });
  return transition(
    tx,
    order,
    'completed',
    {
      completedAt: new Date(),
      completedBy: actorId,
      billNo: `${shop!.code}-${String(counter!.n).padStart(5, '0')}`,
    },
    actorId,
    'completed',
  );
}

/** UPI to the merchant via their YouPI-PG (or a simulated UPI outside prod). */
export async function startUpi(db: Db, shop: ShopRow, actorId: string, orderId: string) {
  const settings = await paymentSettings(db, shop.id);
  const cfg = youpiConfig(settings);
  if (!cfg && !env.mockCounterUpi()) {
    throw new HttpError(
      409,
      'upi_not_set_up',
      'UPI is not set up for this shop. Use card or cash.',
    );
  }
  const { order, attempt } = await db.transaction(async (tx) => {
    const o = await readyForPayment(tx, shop.id, orderId);
    await cancelPending(tx, o.id);
    const [{ n } = { n: 0 }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(counterPayments)
      .where(eq(counterPayments.orderId, o.id));
    return { order: o, attempt: n + 1 };
  });
  const amount = order.finalTotalPaise!;
  let reference: string;
  let payUrl: string;
  if (cfg) {
    const yp = await createYoupiPayment(cfg, {
      orderId: `${order.code}-${attempt}`,
      amountPaise: amount,
      description: `${shop.name} · order ${formatOrderCode(order.code)}`,
      idempotencyKey: `counter:${order.id}:${attempt}`,
    });
    reference = yp.paymentId;
    payUrl = yp.checkoutUrl;
  } else {
    reference = `${MOCK_UPI_PREFIX}${order.id}:${attempt}`;
    payUrl = `upi-simulated://${formatOrderCode(order.code)}`;
  }
  await db.insert(counterPayments).values({
    orderId: order.id,
    method: 'upi',
    amountPaise: amount,
    reference,
    payUrl,
    takenBy: actorId,
  });
  await orderEvent(db, order.id, actorId, 'upi_started', { youpi: !!cfg });
  return staffOrderView(db, order);
}

/** Cashier screen polls this; asks the merchant's YouPI-PG directly (trusted, server-side). */
export async function pollUpi(db: Db, shop: ShopRow, orderId: string) {
  const order = await shopOrder(db, shop.id, orderId);
  const [pay] = await db
    .select()
    .from(counterPayments)
    .where(
      and(
        eq(counterPayments.orderId, order.id),
        eq(counterPayments.status, 'pending'),
        eq(counterPayments.method, 'upi'),
      ),
    );
  if (pay && pay.reference && !pay.reference.startsWith(MOCK_UPI_PREFIX)) {
    const cfg = youpiConfig(await paymentSettings(db, shop.id));
    const status = cfg ? await getYoupiStatus(cfg, pay.reference) : null;
    if (status?.status === 'SUCCESS' && status.amountPaise === pay.amountPaise) {
      const done = await db.transaction((tx) => receive(tx, pay.id, null));
      return staffOrderView(db, done);
    }
    if (status && ['FAILED', 'EXPIRED', 'CANCELLED'].includes(status.status)) {
      await db
        .update(counterPayments)
        .set({ status: 'failed' })
        .where(eq(counterPayments.id, pay.id));
    }
  }
  return staffOrderView(db, await shopOrder(db, shop.id, orderId));
}

/** Outside prod only: the cashier confirms the simulated UPI payment. */
export async function confirmSimulatedUpi(db: Db, shop: ShopRow, actorId: string, orderId: string) {
  if (!env.mockCounterUpi()) throw new HttpError(404, 'not_found', 'Not found');
  const order = await shopOrder(db, shop.id, orderId);
  const [pay] = await db
    .select()
    .from(counterPayments)
    .where(and(eq(counterPayments.orderId, order.id), eq(counterPayments.status, 'pending')));
  if (!pay?.reference?.startsWith(MOCK_UPI_PREFIX)) {
    throw new HttpError(409, 'no_simulated_payment', 'No simulated UPI payment is open');
  }
  const done = await db.transaction((tx) => receive(tx, pay.id, actorId, { utr: 'SIMULATED' }));
  return staffOrderView(db, done);
}

/** Card machine approved: cashier records the approval code. */
export async function recordCard(
  db: Db,
  shop: ShopRow,
  actorId: string,
  orderId: string,
  approvalCode: string,
) {
  const settings = await paymentSettings(db, shop.id);
  if (!settings.acceptsCard) throw new HttpError(409, 'card_off', 'This shop does not take cards');
  const done = await db.transaction(async (tx) => {
    const order = await readyForPayment(tx, shop.id, orderId);
    await cancelPending(tx, order.id);
    const [pay] = await tx
      .insert(counterPayments)
      .values({
        orderId: order.id,
        method: 'card',
        amountPaise: order.finalTotalPaise!,
        reference: approvalCode,
        takenBy: actorId,
      })
      .returning();
    return receive(tx, pay!.id, actorId);
  });
  return staffOrderView(db, done);
}

/** Cash: amount received must cover the bill; change is shown. */
export async function recordCash(
  db: Db,
  shop: ShopRow,
  actorId: string,
  orderId: string,
  receivedPaise: number,
) {
  const settings = await paymentSettings(db, shop.id);
  if (!settings.acceptsCash) throw new HttpError(409, 'cash_off', 'This shop does not take cash');
  const done = await db.transaction(async (tx) => {
    const order = await readyForPayment(tx, shop.id, orderId);
    if (receivedPaise < order.finalTotalPaise!) {
      throw new HttpError(400, 'cash_short', 'Cash received is less than the bill');
    }
    await cancelPending(tx, order.id);
    const [pay] = await tx
      .insert(counterPayments)
      .values({
        orderId: order.id,
        method: 'cash',
        amountPaise: order.finalTotalPaise!,
        receivedPaise,
        takenBy: actorId,
      })
      .returning();
    return receive(tx, pay!.id, actorId);
  });
  return staffOrderView(db, done);
}

/**
 * POST /api/payments/youpi/{shopCode} — the merchant's YouPI-PG reports a UPI
 * result. Trusted only with a valid HMAC; each event applied once; the amount
 * must equal the bill.
 */
export async function processYoupiWebhook(
  db: Db,
  shopCode: string | undefined,
  rawBody: string,
  headers: HeaderReader,
): Promise<string> {
  const [shop] = await db
    .select()
    .from(shops)
    .where(eq(shops.shortCode, (shopCode ?? '').toUpperCase()));
  if (!shop) throw new HttpError(404, 'not_found', 'Not found');
  const settings = await paymentSettings(db, shop.id);
  if (!settings.youpiWebhookSecretEnc) throw new HttpError(404, 'not_found', 'Not found');
  if (
    !verifyYoupiSignature(
      decryptSecret(settings.youpiWebhookSecretEnc),
      rawBody,
      headers.get(YOUPI_SIGNATURE_HEADER),
    )
  ) {
    throw new HttpError(401, 'bad_signature', 'Invalid webhook signature');
  }
  let parsed;
  try {
    parsed = youpiWebhookSchema.parse(JSON.parse(rawBody));
  } catch {
    throw new HttpError(400, 'bad_body', 'Unrecognised webhook body');
  }
  return db.transaction(async (tx) => {
    const [recorded] = await tx
      .insert(counterPaymentEvents)
      .values({
        shopId: shop.id,
        eventKey: `${parsed.paymentId}:${parsed.event}`,
        payloadSha256: sha256(rawBody),
        outcome: 'processing',
      })
      .onConflictDoNothing()
      .returning({ id: counterPaymentEvents.id });
    if (!recorded) return 'duplicate';
    const [pay] = await tx
      .select({ p: counterPayments, shopId: orders.shopId })
      .from(counterPayments)
      .innerJoin(orders, eq(orders.id, counterPayments.orderId))
      .where(eq(counterPayments.reference, parsed.paymentId));
    let outcome: string;
    if (!pay || pay.shopId !== shop.id) outcome = 'unknown_payment';
    else if (parsed.event !== 'SUCCESS') {
      if (pay.p.status === 'pending') {
        await tx
          .update(counterPayments)
          .set({ status: 'failed' })
          .where(eq(counterPayments.id, pay.p.id));
      }
      outcome = `upi_${parsed.event.toLowerCase()}`;
    } else if (parsed.amountPaise !== pay.p.amountPaise) outcome = 'amount_mismatch';
    else if (pay.p.status === 'cancelled' || pay.p.status === 'failed') {
      // Money arrived on a closed attempt: leave it for the merchant to reconcile.
      outcome = 'paid_on_closed_attempt';
    } else {
      await receive(tx, pay.p.id, null, { utr: parsed.utr ?? null });
      outcome = 'received';
    }
    await tx
      .update(counterPaymentEvents)
      .set({ outcome })
      .where(eq(counterPaymentEvents.id, recorded.id));
    return outcome;
  });
}
