import { createHmac } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  billSchema,
  customerOrderSummarySchema,
  type CashierAssistanceItem,
  type CustomerOrder,
  type GateAssistanceNotification,
} from '@pataka/shared';
import { getDb } from '../src/db/client';
import { feePayments, feeRefunds, items, orderEvents, orderLines, orders } from '../src/db/schema';
import {
  cancelHandler,
  decisionHandler,
  myOrdersHandler,
  orderHandler,
  ordersArrivalHandler,
  ordersAssistanceHandler,
  pickupQrHandler,
  placeOrderHandler,
} from '../src/functions/orders';
import { feeWebhookHandler, youpiWebhookHandler } from '../src/functions/payments';
import {
  counterCardHandler,
  counterCashHandler,
  counterOpenHandler,
  counterPackHandler,
  counterPollHandler,
  counterUpiHandler,
  counterUpiSimHandler,
  paymentSettingsPutHandler,
  shopAlternateHandler,
  shopAssistanceRequestsHandler,
  shopAssistanceReviewHandler,
  shopConfirmHandler,
  shopFinishHandler,
  shopOrderHandler,
  shopOrdersHandler,
  shopOutOfStockHandler,
  shopPickHandler,
  shopRejectHandler,
  shopScanHandler,
  shopStartPackingHandler,
  shopStickerHandler,
} from '../src/functions/shop';
import {
  gateAcknowledgeHandler,
  gateLookupHandler,
  gateNotificationsHandler,
} from '../src/functions/gate';
import { expireUnconfirmed, refundFee } from '../src/lib/orders';
import { mockProvider, signMockEvent } from '../src/lib/payments/mock';
import { HttpRequest } from '@azure/functions';
import { body, call, errorCode, makeListedShop, makeUser } from './helpers';
import { cust, lineIdFor, packedOrder, paidOrder, payFee, placed, staff } from './orderHelpers';

const refundsFor = async (orderId: string) => {
  const db = getDb();
  const rows = await db.select().from(feeRefunds);
  const [o] = await db.select().from(orders).where(eq(orders.id, orderId));
  return { rows, order: o! };
};

describe('my orders list', () => {
  it('lists every active line with its name, quantity, unit price and status', async () => {
    const shop = await makeListedShop();
    const { customer } = await placed(shop, [
      [0, 2],
      [1, 1],
      [3, 3],
    ]);
    const res = await call(myOrdersHandler, { method: 'GET', session: customer.session });
    const [summary] = customerOrderSummarySchema.array().parse(res.jsonBody);
    expect(summary!.lineCount).toBe(3);
    expect(summary!.lines).toEqual([
      expect.objectContaining({
        itemNo: 1,
        nameEn: 'Item 1',
        qty: 2,
        unitPricePaise: 10000,
        status: 'pending',
      }),
      expect.objectContaining({
        itemNo: 2,
        nameEn: 'Item 2',
        qty: 1,
        unitPricePaise: 20000,
        status: 'pending',
      }),
      expect.objectContaining({
        itemNo: 4,
        nameEn: 'Item 4',
        qty: 3,
        unitPricePaise: 40000,
        status: 'pending',
      }),
    ]);
  });
});

describe('placing an order (G11, L1)', () => {
  afterEach(() => {
    process.env.ORDERING_ENABLED = 'true';
  });

  it('prices from the catalogue (offer price while it runs) and waits for the ₹30 fee', async () => {
    const shop = await makeListedShop();
    await getDb()
      .update(items)
      .set({ offerPricePaise: 8000 })
      .where(eq(items.id, shop.items[0]!.id));
    const { order } = await placed(shop, [
      [0, 2],
      [1, 1],
    ]);
    expect(order.status).toBe('fee_pending');
    expect(order.lines.map((l) => l.unitPricePaise)).toEqual([8000, 20000]);
    expect(order.estimatedTotalPaise).toBe(36000);
    expect(order.fee).toMatchObject({ amountPaise: 3000, status: 'unpaid' });
    expect(order.fee.checkout?.url).toMatch(/^\/pay\/mock\//);
  });

  it('is refused when ordering is switched off', async () => {
    process.env.ORDERING_ENABLED = 'false';
    const shop = await makeListedShop();
    const customer = await makeUser();
    const res = await call(placeOrderHandler, {
      method: 'POST',
      session: customer.session,
      body: { shopCode: 'SLC01', lines: [{ itemId: shop.items[0]!.id, qty: 1 }] },
    });
    expect(errorCode(res)).toBe('ordering_disabled');
  });

  it('refuses sold-out items, too much stock, other shops’ items and banned categories', async () => {
    const shop = await makeListedShop();
    const other = await makeListedShop('BAL01');
    const customer = await makeUser();
    const place = (itemId: string, qty = 1) =>
      call(placeOrderHandler, {
        method: 'POST',
        session: customer.session,
        body: { shopCode: 'SLC01', lines: [{ itemId, qty }] },
      });
    expect(errorCode(await place(shop.items[2]!.id, 2))).toBe('not_enough_stock');
    expect(errorCode(await place(other.items[0]!.id))).toBe('item_unavailable');
    await getDb().update(items).set({ isSoldOut: true }).where(eq(items.id, shop.items[1]!.id));
    expect(errorCode(await place(shop.items[1]!.id))).toBe('item_sold_out');
  });
});

describe('₹30 platform fee (SPEC_V3 §4)', () => {
  it('a verified provider event places the order; replays change nothing', async () => {
    const shop = await makeListedShop();
    const { customer, order } = await placed(shop);
    const res = await payFee(customer.session, order);
    expect(body<{ outcome: string }>(res).outcome).toBe('placed');
    const now = cust(
      await call(orderHandler, { session: customer.session, params: { id: order.id } }),
    );
    expect(now.status).toBe('placed');
    expect(now.fee.status).toBe('paid');
    expect(new Date(now.confirmBy!).getTime() - new Date(now.placedAt!).getTime()).toBe(
      72 * 3_600_000,
    );

    // Replay the same signed event through the public webhook endpoint.
    const signed = signMockEvent({
      id: 'evt-replay-1',
      type: 'payment.captured',
      checkoutId: order.fee.checkout!.checkoutId,
      paymentId: 'pay-1',
      amountPaise: 3000,
    });
    const hook = (raw: string, sig: string | null) =>
      feeWebhookHandler(
        new HttpRequest({
          method: 'POST',
          url: 'http://localhost/api/payments/webhook/mock',
          params: { provider: 'mock' },
          headers: sig ? { 'x-mock-signature': sig } : {},
          body: { string: raw },
        }),
      );
    const sig = signed.headers.get('x-mock-signature');
    expect(body<{ outcome: string }>(await hook(signed.rawBody, sig)).outcome).toBe(
      'already_captured',
    );
    expect(body<{ outcome: string }>(await hook(signed.rawBody, sig)).outcome).toBe('duplicate');
    expect((await hook(signed.rawBody, 'sha256=00')).status).toBe(401);
    expect((await hook(signed.rawBody, null)).status).toBe(401);
  });

  it('rejects an event whose amount differs from the fee', async () => {
    const shop = await makeListedShop();
    const { order } = await placed(shop);
    const signed = signMockEvent({
      id: 'evt-amount',
      type: 'payment.captured',
      checkoutId: order.fee.checkout!.checkoutId,
      paymentId: 'pay-x',
      amountPaise: 100,
    });
    const res = await feeWebhookHandler(
      new HttpRequest({
        method: 'POST',
        url: 'http://localhost/api/payments/webhook/mock',
        params: { provider: 'mock' },
        headers: { 'x-mock-signature': signed.headers.get('x-mock-signature')! },
        body: { string: signed.rawBody },
      }),
    );
    expect(body<{ outcome: string }>(res).outcome).toBe('amount_mismatch');
    const [o] = await getDb().select().from(orders).where(eq(orders.id, order.id));
    expect(o!.status).toBe('fee_pending');
  });

  it('merchants never see orders whose fee is unpaid', async () => {
    const shop = await makeListedShop();
    const { order } = await placed(shop);
    const list = await call(shopOrdersHandler, {
      session: shop.staff.session,
      query: { view: 'incoming' },
    });
    expect(body<unknown[]>(list)).toHaveLength(0);
    const one = await call(shopOrderHandler, {
      session: shop.staff.session,
      params: { id: order.id },
    });
    expect(one.status).toBe(404);
  });

  it('refunds in full when not confirmed within 3 days (job)', async () => {
    const shop = await makeListedShop();
    const { order } = await paidOrder(shop);
    expect(await expireUnconfirmed(getDb(), new Date(Date.now() + 71 * 3_600_000))).toBe(0);
    expect(await expireUnconfirmed(getDb(), new Date(Date.now() + 73 * 3_600_000))).toBe(1);
    const { rows, order: o } = await refundsFor(order.id);
    expect(o.status).toBe('expired');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'processed', amountPaise: 3000 });
    // Running again never refunds twice.
    await expireUnconfirmed(getDb(), new Date(Date.now() + 80 * 3_600_000));
    expect((await refundsFor(order.id)).rows).toHaveLength(1);
  });

  it('refunds when the merchant rejects or the customer cancels before confirmation', async () => {
    const shop = await makeListedShop();
    const a = await paidOrder(shop);
    const rej = await call(shopRejectHandler, {
      method: 'POST',
      session: shop.staff.session,
      params: { id: a.order.id },
      body: { reason: 'Closed today' },
    });
    expect(staff(rej).status).toBe('rejected');
    const b = await paidOrder(shop);
    const can = await call(cancelHandler, {
      method: 'POST',
      session: b.customer.session,
      params: { id: b.order.id },
      body: {},
    });
    expect(cust(can).fee.status).toBe('refunded');
    expect(
      (await getDb().select().from(feeRefunds)).filter((r) => r.status === 'processed'),
    ).toHaveLength(2);
  });

  it('refunds the fee when customer cancels after merchant confirmation but before packing', async () => {
    const shop = await makeListedShop();
    const { customer, order } = await paidOrder(shop);
    const confirmed = await call(shopConfirmHandler, {
      method: 'POST',
      session: shop.staff.session,
      params: { id: order.id },
    });
    expect(staff(confirmed).status).toBe('confirmed');

    // Merchant confirmation alone leaves the fee refundable
    const viewBefore = await call(orderHandler, {
      session: customer.session,
      params: { id: order.id },
    });
    expect(cust(viewBefore).fee.status).toBe('paid');

    const can = await call(cancelHandler, {
      method: 'POST',
      session: customer.session,
      params: { id: order.id },
      body: { reason: 'Changed my mind' },
    });
    expect(cust(can)).toMatchObject({ status: 'cancelled', fee: { status: 'refunded' } });
    const refunds = await getDb().select().from(feeRefunds);
    expect(refunds.filter((r) => r.status === 'processed')).toHaveLength(1);
  });

  it('refunds the fee when customer cancels while packing is in progress (before finishPacking)', async () => {
    const shop = await makeListedShop();
    const { customer, order } = await paidOrder(shop);
    await call(shopConfirmHandler, {
      method: 'POST',
      session: shop.staff.session,
      params: { id: order.id },
    });
    const started = await call(shopStartPackingHandler, {
      method: 'POST',
      session: shop.packer.session,
      params: { id: order.id },
    });
    expect(staff(started).status).toBe('packing');

    const can = await call(cancelHandler, {
      method: 'POST',
      session: customer.session,
      params: { id: order.id },
      body: { reason: 'Taking too long' },
    });
    expect(cust(can)).toMatchObject({ status: 'cancelled', fee: { status: 'refunded' } });
    const refunds = await getDb().select().from(feeRefunds);
    expect(refunds.filter((r) => r.status === 'processed')).toHaveLength(1);
  });

  it('keeps the fee once packing is completed, even if cancelled later', async () => {
    const shop = await makeListedShop();
    const p = await packedOrder(shop);

    // After packing finishes, the fee is non-refundable (status: kept)
    const viewPacked = await call(orderHandler, {
      session: p.customer.session,
      params: { id: p.order.id },
    });
    expect(cust(viewPacked).fee.status).toBe('kept');

    // Customer cancels after packing
    const can = await call(cancelHandler, {
      method: 'POST',
      session: p.customer.session,
      params: { id: p.order.id },
      body: { reason: 'Cannot make it to shop' },
    });
    expect(cust(can)).toMatchObject({ status: 'cancelled', fee: { status: 'kept' } });

    // No refund row created
    expect(await getDb().select().from(feeRefunds)).toHaveLength(0);

    // fee_retained event logged
    const events = await getDb()
      .select()
      .from(orderEvents)
      .where(eq(orderEvents.orderId, p.order.id));
    expect(events.some((e) => e.type === 'fee_retained')).toBe(true);
  });
});

describe('₹30 platform fee edge cases', () => {
  it('Test 1: duplicate refund triggers only create one refund record', async () => {
    const shop = await makeListedShop();
    const { customer, order } = await paidOrder(shop);
    await call(shopConfirmHandler, {
      method: 'POST',
      session: shop.staff.session,
      params: { id: order.id },
    });
    // Customer cancels before packing is finished
    const can = await call(cancelHandler, {
      method: 'POST',
      session: customer.session,
      params: { id: order.id },
      body: { reason: 'Cancel 1' },
    });
    expect(cust(can)).toMatchObject({ status: 'cancelled', fee: { status: 'refunded' } });

    const pays = await getDb().select().from(feePayments).where(eq(feePayments.orderId, order.id));
    const refundsFirst = await getDb()
      .select()
      .from(feeRefunds)
      .where(eq(feeRefunds.feePaymentId, pays[0]!.id));
    expect(refundsFirst).toHaveLength(1);
    expect(refundsFirst[0]!.status).toBe('processed');

    // Trigger refund operation a second time directly
    const secondRefund = await refundFee(
      getDb(),
      order.id,
      customer.user.id,
      'Duplicate cancel trigger',
    );
    expect(secondRefund?.id).toBe(refundsFirst[0]!.id);

    // Verify only one refund row exists in total
    const refundsSecond = await getDb()
      .select()
      .from(feeRefunds)
      .where(eq(feeRefunds.feePaymentId, pays[0]!.id));
    expect(refundsSecond).toHaveLength(1);
  });

  it('Test 2: multiple captured payments refund the unrefunded eligible payment without double-refunding', async () => {
    const shop = await makeListedShop();
    const { customer, order } = await paidOrder(shop);
    const db = getDb();

    // Query initial captured payment
    const [pay1] = await db.select().from(feePayments).where(eq(feePayments.orderId, order.id));
    expect(pay1).toBeDefined();

    // Simulate a second captured payment record for the same order
    const [pay2] = await db
      .insert(feePayments)
      .values({
        orderId: order.id,
        provider: 'mock',
        checkoutId: 'mock_chk_dup2',
        checkoutUrl: 'http://test/chk2',
        amountPaise: 3000,
        status: 'captured',
        providerPaymentId: 'mock_pay_dup2',
        capturedAt: new Date(Date.now() + 2000),
        idempotencyKey: `fee:${order.id}:2`,
      })
      .returning();

    // Refund #1: should refund pay2 (latest captured)
    const ref1 = await refundFee(db, order.id, customer.user.id, 'Refund pay2');
    expect(ref1?.feePaymentId).toBe(pay2!.id);
    expect(ref1?.status).toBe('processed');

    // Refund #2: should skip pay2 (already refunded) and refund pay1
    const ref2 = await refundFee(db, order.id, customer.user.id, 'Refund pay1');
    expect(ref2?.feePaymentId).toBe(pay1!.id);
    expect(ref2?.status).toBe('processed');

    // Refund #3: both pay1 and pay2 are already refunded, should not create a third refund
    const ref3 = await refundFee(db, order.id, customer.user.id, 'Refund pay3');
    expect(ref3?.feePaymentId).toBe(pay2!.id); // returns existing live refund
    const allRefunds = await db.select().from(feeRefunds);
    const orderRefunds = allRefunds.filter(
      (r) => r.feePaymentId === pay1!.id || r.feePaymentId === pay2!.id,
    );
    expect(orderRefunds).toHaveLength(2);
  });

  it('Test 3: provider failure marks refund as failed and does not show premature success to customer', async () => {
    const shop = await makeListedShop();
    const { customer, order } = await paidOrder(shop);
    await call(shopConfirmHandler, {
      method: 'POST',
      session: shop.staff.session,
      params: { id: order.id },
    });

    const failingProvider = {
      ...mockProvider,
      refund: vi.fn().mockRejectedValue(new Error('Payment gateway timeout')),
    };

    await expect(
      refundFee(getDb(), order.id, customer.user.id, 'Customer cancel', failingProvider),
    ).rejects.toThrow('Payment gateway timeout');

    // Verify refund record exists and is marked 'failed'
    const [pay] = await getDb().select().from(feePayments).where(eq(feePayments.orderId, order.id));
    const [failedRefund] = await getDb()
      .select()
      .from(feeRefunds)
      .where(eq(feeRefunds.feePaymentId, pay!.id));
    expect(failedRefund).toBeDefined();
    expect(failedRefund!.status).toBe('failed');

    // Verify order event recorded
    const events = await getDb()
      .select()
      .from(orderEvents)
      .where(eq(orderEvents.orderId, order.id));
    expect(events.some((e) => e.type === 'fee_refund_failed')).toBe(true);

    // Verify customer view does NOT show refunded
    const view = await call(orderHandler, { session: customer.session, params: { id: order.id } });
    expect(cust(view).fee.status).toBe('refund_failed');
    expect(cust(view).fee.status).not.toBe('refunded');
  });

  it('Test 4: refund retry succeeds after failure and prevents duplicate attempts', async () => {
    const shop = await makeListedShop();
    const { customer, order } = await paidOrder(shop);
    await call(shopConfirmHandler, {
      method: 'POST',
      session: shop.staff.session,
      params: { id: order.id },
    });

    // Step 1: Simulate initial failure
    const failingProvider = {
      ...mockProvider,
      refund: vi.fn().mockRejectedValue(new Error('Network drop')),
    };
    await expect(
      refundFee(getDb(), order.id, customer.user.id, 'Attempt 1', failingProvider),
    ).rejects.toThrow('Network drop');

    const [pay] = await getDb().select().from(feePayments).where(eq(feePayments.orderId, order.id));
    const refundsAfterFail = await getDb()
      .select()
      .from(feeRefunds)
      .where(eq(feeRefunds.feePaymentId, pay!.id));
    expect(refundsAfterFail).toHaveLength(1);
    expect(refundsAfterFail[0]!.status).toBe('failed');

    // Step 2: Retry with normal working provider
    const retryRefund = await refundFee(getDb(), order.id, customer.user.id, 'Retry attempt 2');
    expect(retryRefund?.status).toBe('processed');

    const refundsAfterRetry = await getDb()
      .select()
      .from(feeRefunds)
      .where(eq(feeRefunds.feePaymentId, pay!.id));
    expect(refundsAfterRetry).toHaveLength(2);
    expect(refundsAfterRetry.map((r) => r.status).sort()).toEqual(['failed', 'processed']);

    // Customer view now shows refunded
    const view = await call(orderHandler, { session: customer.session, params: { id: order.id } });
    expect(cust(view).fee.status).toBe('refunded');

    // Step 3: Repeated retry does not create a 3rd record
    await refundFee(getDb(), order.id, customer.user.id, 'Retry attempt 3');
    const refundsAfterThird = await getDb()
      .select()
      .from(feeRefunds)
      .where(eq(feeRefunds.feePaymentId, pay!.id));
    expect(refundsAfterThird).toHaveLength(2);
  });

  it('Test 5: completed order invariant - an order cannot become completed without successful packing', async () => {
    const shop = await makeListedShop();
    const { order } = await paidOrder(shop);
    // 1. Trying to collect payment on counter before packing is rejected
    const early = await call(counterCashHandler, {
      method: 'POST',
      session: shop.cashier.session,
      params: { id: order.id },
      body: { receivedPaise: 50000 },
    });
    expect(errorCode(early)).toBe('not_ready');

    // 2. Confirm order
    await call(shopConfirmHandler, {
      method: 'POST',
      session: shop.staff.session,
      params: { id: order.id },
    });

    // 3. Trying to collect payment on counter after confirm but before packing is rejected
    const afterConfirm = await call(counterCashHandler, {
      method: 'POST',
      session: shop.cashier.session,
      params: { id: order.id },
      body: { receivedPaise: 50000 },
    });
    expect(errorCode(afterConfirm)).toBe('not_ready');

    // 4. Inspect DB: order has not been completed
    const [dbOrder] = await getDb().select().from(orders).where(eq(orders.id, order.id));
    expect(dbOrder!.status).not.toBe('completed');
    expect(dbOrder!.packedAt).toBeNull();
  });

  it('Test 6: only successful finishPacking makes fee non-refundable; started packing or partial scans remain refundable', async () => {
    const shop = await makeListedShop();
    const p = await paidOrder(shop, [
      [0, 2],
      [1, 1],
    ]);
    const id = { params: { id: p.order.id } };

    // 1. Confirm order
    await call(shopConfirmHandler, { method: 'POST', session: shop.staff.session, ...id });

    // 2. Start packing - fee is still paid (refundable)
    await call(shopStartPackingHandler, { method: 'POST', session: shop.packer.session, ...id });
    const viewStarted = cust(await call(orderHandler, { session: p.customer.session, ...id }));
    expect(viewStarted.status).toBe('packing');
    expect(viewStarted.fee.status).toBe('paid');

    // 3. Partial scan - scan only 1 of 2 units of item 0
    await call(shopScanHandler, {
      method: 'POST',
      session: shop.packer.session,
      ...id,
      body: {
        barcode: shop.items[0]!.barcode!,
        lineId: await lineIdFor(p.order.id, shop.items[0]!.barcode!),
      },
    });
    const viewPartial = cust(await call(orderHandler, { session: p.customer.session, ...id }));
    expect(viewPartial.fee.status).toBe('paid');

    // 4. Attempting sticker reprint or finish while incomplete fails
    const prematureFin = await call(shopFinishHandler, {
      method: 'POST',
      session: shop.packer.session,
      ...id,
    });
    expect(errorCode(prematureFin)).toBe('not_ready');
    const prematureSticker = await call(shopStickerHandler, {
      method: 'POST',
      session: shop.packer.session,
      ...id,
    });
    expect(errorCode(prematureSticker)).toBe('not_packed');

    // 5. Cancelling while partially packed still refunds the fee
    const can = cust(
      await call(cancelHandler, {
        method: 'POST',
        session: p.customer.session,
        ...id,
        body: { reason: 'Partial cancel' },
      }),
    );
    expect(can.status).toBe('cancelled');
    expect(can.fee.status).toBe('refunded');

    // 6. Now with a fresh order, complete packing fully
    const p2 = await paidOrder(shop, [[0, 1]]);
    const id2 = { params: { id: p2.order.id } };
    await call(shopConfirmHandler, { method: 'POST', session: shop.staff.session, ...id2 });
    await call(shopStartPackingHandler, { method: 'POST', session: shop.packer.session, ...id2 });
    await call(shopScanHandler, {
      method: 'POST',
      session: shop.packer.session,
      ...id2,
      body: {
        barcode: shop.items[0]!.barcode!,
        lineId: await lineIdFor(p2.order.id, shop.items[0]!.barcode!),
      },
    });
    const fin = await call(shopFinishHandler, {
      method: 'POST',
      session: shop.packer.session,
      ...id2,
    });
    expect(fin.status).toBe(200);

    const viewPacked = cust(await call(orderHandler, { session: p2.customer.session, ...id2 }));
    expect(viewPacked.status).toBe('packed');
    expect(viewPacked.fee.status).toBe('kept');

    // Cancelling after successful finishPacking keeps fee
    const canPacked = cust(
      await call(cancelHandler, {
        method: 'POST',
        session: p2.customer.session,
        ...id2,
        body: { reason: 'Late cancel' },
      }),
    );
    expect(canPacked.status).toBe('cancelled');
    expect(canPacked.fee.status).toBe('kept');
  });
});

describe('packing', () => {
  async function packing() {
    const shop = await makeListedShop();
    const p = await paidOrder(shop, [
      [0, 2],
      [1, 1],
      [3, 1],
    ]);
    const id = { params: { id: p.order.id } };
    await call(shopConfirmHandler, { method: 'POST', session: shop.staff.session, ...id });
    await call(shopStartPackingHandler, { method: 'POST', session: shop.packer.session, ...id });
    const scan = async (barcode: string, lineId?: string) =>
      call(shopScanHandler, {
        method: 'POST',
        session: shop.packer.session,
        ...id,
        body: { barcode, lineId: lineId ?? (await lineIdFor(p.order.id, barcode)) },
      });
    return { shop, ...p, id, scan };
  }

  it('scans count units; unknown, foreign and extra scans are refused', async () => {
    const { shop, scan, id } = await packing();
    expect(staff(await scan(shop.items[0]!.barcode!)).lines[0]).toMatchObject({
      pickedQty: 1,
      status: 'pending',
    });
    expect(staff(await scan(shop.items[0]!.barcode!)).lines[0]).toMatchObject({
      pickedQty: 2,
      status: 'picked',
    });
    expect(errorCode(await scan(shop.items[0]!.barcode!))).toBe('already_picked');
    expect(errorCode(await scan(shop.items[2]!.barcode!))).toBe('wrong_item');
    expect(errorCode(await scan('NOPE-1234'))).toBe('unknown_barcode');
    const early = await call(shopFinishHandler, {
      method: 'POST',
      session: shop.packer.session,
      ...id,
    });
    expect(errorCode(early)).toBe('not_ready');
  });

  it('store-barcode items may be picked by hand; box-barcoded ones must be scanned', async () => {
    const { shop, order, id } = await packing();
    const byHand = (lineId: string) =>
      call(shopPickHandler, {
        method: 'POST',
        session: shop.packer.session,
        ...id,
        body: { lineId },
      });
    const before = staff(
      await call(shopOrderHandler, { session: shop.packer.session, ...id }),
    ).lines;
    expect(before.map((l) => l.canPickByHand)).toEqual([false, false, true]);
    expect(errorCode(await byHand(order.lines[0]!.id))).toBe('scan_required');
    expect(staff(await byHand(order.lines[2]!.id)).lines[2]!.status).toBe('picked');
  });

  it('a barcode for another line in the order is refused for the line being packed', async () => {
    const { shop, order, scan } = await packing();
    const res = await scan(shop.items[1]!.barcode!, order.lines[0]!.id);
    expect(errorCode(res)).toBe('wrong_item');
    expect(body<{ error: { message: string } }>(res).error.message).toMatch(/^Wrong item:/);
    const [line0, line1] = await getDb()
      .select()
      .from(orderLines)
      .where(eq(orderLines.orderId, order.id))
      .orderBy(orderLines.lineNo);
    expect([line0!.pickedQty, line1!.pickedQty]).toEqual([0, 0]);
    // the right barcode on that line is accepted
    expect(staff(await scan(shop.items[0]!.barcode!, order.lines[0]!.id)).lines[0]!.pickedQty).toBe(
      1,
    );
  });

  it('a generated store barcode can also be scanned from its printed label', async () => {
    const { shop, order, scan } = await packing();
    const label = shop.items[3]!.barcode!;
    expect(label).toMatch(/^20\d{11}$/);
    const after = staff(await scan(label));
    expect(after.lines.find((l) => l.id === order.lines[2]!.id)!.pickedQty).toBe(1);
  });

  it('out of stock asks the customer; removing it lets packing finish with the new total', async () => {
    const { shop, customer, order, id, scan } = await packing();
    await scan(shop.items[0]!.barcode!);
    await scan(shop.items[0]!.barcode!);
    await call(shopPickHandler, {
      method: 'POST',
      session: shop.packer.session,
      ...id,
      body: { lineId: order.lines[2]!.id },
    });
    const oos = staff(
      await call(shopOutOfStockHandler, {
        method: 'POST',
        session: shop.packer.session,
        ...id,
        body: { lineId: order.lines[1]!.id },
      }),
    );
    expect(oos.status).toBe('awaiting_customer');
    // Packer cannot finish while the customer has not answered.
    expect(
      (await call(shopFinishHandler, { method: 'POST', session: shop.packer.session, ...id }))
        .status,
    ).toBe(409);

    const decided = cust(
      await call(decisionHandler, {
        method: 'POST',
        session: customer.session,
        ...id,
        body: { lineId: order.lines[1]!.id, decision: 'remove' },
      }),
    );
    expect(decided.status).toBe('packing');
    const fin = await call(shopFinishHandler, {
      method: 'POST',
      session: shop.packer.session,
      ...id,
    });
    expect(body<{ packNo: number; qr: string }>(fin)).toMatchObject({ packNo: 1 });
    const [o] = await getDb().select().from(orders).where(eq(orders.id, order.id));
    expect(o!.finalTotalPaise).toBe(2 * 10000 + 40000);
  });

  it('an accepted alternative becomes a new line to pick; a declined one is removed', async () => {
    const { shop, customer, order, id } = await packing();
    const alt = staff(
      await call(shopAlternateHandler, {
        method: 'POST',
        session: shop.packer.session,
        ...id,
        body: { lineId: order.lines[1]!.id, itemId: shop.items[2]!.id, qty: 1 },
      }),
    );
    expect(alt.lines[1]).toMatchObject({
      status: 'alternate_proposed',
      alternate: { qty: 1, unitPricePaise: 30000 },
    });
    // Silence is never approval: nothing changes until the customer answers.
    expect(alt.status).toBe('awaiting_customer');
    const accepted = cust(
      await call(decisionHandler, {
        method: 'POST',
        session: customer.session,
        ...id,
        body: { lineId: order.lines[1]!.id, decision: 'accept' },
      }),
    );
    expect(accepted.lines.find((l) => l.id === order.lines[1]!.id)!.status).toBe('replaced');
    expect(accepted.lines.at(-1)).toMatchObject({
      itemId: shop.items[2]!.id,
      status: 'pending',
      replacesLineId: order.lines[1]!.id,
    });
  });

  it('only one of two concurrent orders can take the last unit in stock', async () => {
    const shop = await makeListedShop();
    const mk = async () => {
      const p = await paidOrder(shop, [[2, 1]]);
      const id = { params: { id: p.order.id } };
      await call(shopConfirmHandler, { method: 'POST', session: shop.staff.session, ...id });
      await call(shopStartPackingHandler, { method: 'POST', session: shop.packer.session, ...id });
      return id;
    };
    const [a, b] = [await mk(), await mk()];
    const results = await Promise.all(
      [a, b].map(async (id) =>
        call(shopScanHandler, {
          method: 'POST',
          session: shop.packer.session,
          ...id,
          body: {
            barcode: shop.items[2]!.barcode!,
            lineId: await lineIdFor(id.params.id, shop.items[2]!.barcode!),
          },
        }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const [it3] = await getDb().select().from(items).where(eq(items.id, shop.items[2]!.id));
    expect(it3!.stockQty).toBe(0);
  });
});

describe('Express Pickup counter', () => {
  it('customer QR → pack sticker must match → cash → bill; replays refused', async () => {
    const shop = await makeListedShop();
    const p = await packedOrder(shop);
    const open = staff(
      await call(counterOpenHandler, {
        method: 'POST',
        session: shop.cashier.session,
        body: { qr: p.pickupQr },
      }),
    );
    expect(open).toMatchObject({
      status: 'packed',
      packNo: 1,
      packMatched: false,
      finalTotalPaise: 40000,
    });

    // A sticker from another order is refused.
    const other = await packedOrder(shop, [[1, 1]]);
    const wrong = await call(counterPackHandler, {
      method: 'POST',
      session: shop.cashier.session,
      params: { id: open.id },
      body: { qr: other.sticker.qr },
    });
    expect(errorCode(wrong)).toBe('wrong_pack');
    // Paying before the pack is matched is refused.
    const early = await call(counterCashHandler, {
      method: 'POST',
      session: shop.cashier.session,
      params: { id: open.id },
      body: { receivedPaise: 50000 },
    });
    expect(errorCode(early)).toBe('pack_not_matched');

    await call(counterPackHandler, {
      method: 'POST',
      session: shop.cashier.session,
      params: { id: open.id },
      body: { qr: p.sticker.qr },
    });
    const short = await call(counterCashHandler, {
      method: 'POST',
      session: shop.cashier.session,
      params: { id: open.id },
      body: { receivedPaise: 100 },
    });
    expect(errorCode(short)).toBe('cash_short');
    const paid = staff(
      await call(counterCashHandler, {
        method: 'POST',
        session: shop.cashier.session,
        params: { id: open.id },
        body: { receivedPaise: 50000 },
      }),
    );
    expect(paid.status).toBe('completed');
    expect(paid.counterPayment).toMatchObject({
      method: 'cash',
      status: 'received',
      changePaise: 10000,
    });
    const bill = billSchema.parse(paid.bill);
    expect(bill).toMatchObject({
      billNo: 'SLC01-00001',
      totalPaise: 40000,
      payment: { method: 'cash' },
    });
    expect(bill.lines).toHaveLength(2);

    // The customer sees the bill.
    const mine = cust(
      await call(orderHandler, { session: p.customer.session, params: { id: p.order.id } }),
    );
    expect(mine.bill?.billNo).toBe('SLC01-00001');

    const again = await call(counterOpenHandler, {
      method: 'POST',
      session: shop.cashier.session,
      body: { qr: p.pickupQr },
    });
    expect(errorCode(again)).toBe('already_collected');
  });

  it('refuses a pickup QR from another shop', async () => {
    const a = await makeListedShop('SLC01');
    const b = await makeListedShop('BAL01');
    const p = await packedOrder(a);
    const foreign = await call(counterOpenHandler, {
      method: 'POST',
      session: b.cashier.session,
      body: { qr: p.pickupQr },
    });
    expect(errorCode(foreign)).toBe('wrong_shop');
  });

  it('the customer is shown the pack sticker QR itself; counter and gate accept it', async () => {
    const shop = await makeListedShop();
    const p = await packedOrder(shop);
    const id = { params: { id: p.order.id } };
    const pickup = async () =>
      body<{ qr: string }>(
        await call(pickupQrHandler, { method: 'POST', session: p.customer.session, ...id }),
      ).qr;

    // Same payload, character for character; refreshing does not change it.
    expect(p.pickupQr).toBe(p.sticker.qr);
    expect(p.pickupQr).toMatch(/^DXK1\.[0-9A-Z]{26}$/);
    expect(await pickup()).toBe(p.sticker.qr);
    // The sticker still carries the customer's name and phone beside the QR.
    expect(p.sticker.customerPhone).toBeTruthy();

    // A reprinted sticker becomes the customer's QR; the old one stops working.
    const reprint = body<{ qr: string }>(
      await call(shopStickerHandler, { method: 'POST', session: shop.packer.session, ...id }),
    );
    expect(reprint.qr).not.toBe(p.sticker.qr);
    expect(await pickup()).toBe(reprint.qr);
    const stale = await call(counterOpenHandler, {
      method: 'POST',
      session: shop.cashier.session,
      body: { qr: p.sticker.qr },
    });
    expect(errorCode(stale)).toBe('qr_not_found');

    const gate = await call(gateLookupHandler, {
      method: 'POST',
      session: shop.marshal.session,
      headers: { 'x-cluster-id': shop.cluster.id },
      body: { qr: reprint.qr },
    });
    expect(gate.status).toBe(200);
    expect(body<{ packNo: number }>(gate).packNo).toBe(1);

    // Counter: the phone QR opens the order, then the physical sticker must still match.
    const open = staff(
      await call(counterOpenHandler, {
        method: 'POST',
        session: shop.cashier.session,
        body: { qr: reprint.qr },
      }),
    );
    expect(open).toMatchObject({ id: p.order.id, packMatched: false });
    const matched = staff(
      await call(counterPackHandler, {
        method: 'POST',
        session: shop.cashier.session,
        params: { id: open.id },
        body: { qr: reprint.qr },
      }),
    );
    expect(matched.packMatched).toBe(true);
  });

  it('an order packed before the sticker QR was kept still gets a working customer QR', async () => {
    const shop = await makeListedShop();
    const p = await packedOrder(shop);
    await getDb().update(orders).set({ packQr: null }).where(eq(orders.id, p.order.id));
    const legacy = body<{ qr: string }>(
      await call(pickupQrHandler, {
        method: 'POST',
        session: p.customer.session,
        params: { id: p.order.id },
      }),
    ).qr;
    expect(legacy).toMatch(/^DXO1\./);
    const open = staff(
      await call(counterOpenHandler, {
        method: 'POST',
        session: shop.cashier.session,
        body: { qr: legacy },
      }),
    );
    expect(open.id).toBe(p.order.id);
  });

  it('card and simulated UPI complete the order', async () => {
    const shop = await makeListedShop();
    const ready = async () => {
      const p = await packedOrder(shop, [[1, 1]]);
      const id = { params: { id: p.order.id } };
      await call(counterPackHandler, {
        method: 'POST',
        session: shop.cashier.session,
        ...id,
        body: { qr: p.sticker.qr },
      });
      return id;
    };
    const c = await ready();
    const card = staff(
      await call(counterCardHandler, {
        method: 'POST',
        session: shop.cashier.session,
        ...c,
        body: { approvalCode: 'AP1234' },
      }),
    );
    expect(card).toMatchObject({
      status: 'completed',
      counterPayment: { method: 'card', reference: 'AP1234' },
    });

    const u = await ready();
    const started = staff(
      await call(counterUpiHandler, { method: 'POST', session: shop.cashier.session, ...u }),
    );
    expect(started.counterPayment).toMatchObject({ method: 'upi', status: 'pending' });
    const done = staff(
      await call(counterUpiSimHandler, { method: 'POST', session: shop.cashier.session, ...u }),
    );
    expect(done.status).toBe('completed');
  });

  describe("merchant's YouPI-PG", () => {
    let server: Server | undefined;
    afterEach(() => server?.close());

    it('creates the payment on the merchant’s instance and completes on a signed webhook or a status poll', async () => {
      const calls: { method: string; url: string; body: string; idem?: string }[] = [];
      let status = 'ACTIVE';
      server = createServer((req, res) => {
        let raw = '';
        req.on('data', (c) => (raw += c));
        req.on('end', () => {
          calls.push({
            method: req.method!,
            url: req.url!,
            body: raw,
            idem: req.headers['idempotency-key'] as string,
          });
          res.setHeader('content-type', 'application/json');
          if (req.method === 'POST') {
            const b = JSON.parse(raw) as { orderId: string; amount: string };
            res.end(
              JSON.stringify({
                paymentId: `yp-${calls.length}`,
                orderId: b.orderId,
                amount: b.amount,
                amountPaise: String(Math.round(Number(b.amount) * 100)),
                currency: 'INR',
                status: 'INITIATED',
                checkoutUrl: 'https://pay.example/checkout/1',
              }),
            );
          } else {
            res.end(
              JSON.stringify({
                paymentId: req.url!.split('/').pop(),
                orderId: 'x',
                amount: '200.00',
                amountPaise: '20000',
                currency: 'INR',
                status,
                method: 'UPI',
              }),
            );
          }
        });
      });
      await new Promise<void>((r) => server!.listen(0, r));
      const port = (server.address() as AddressInfo).port;

      const shop = await makeListedShop();
      const secret = 'merchant-webhook-secret-123456';
      await call(paymentSettingsPutHandler, {
        method: 'PUT',
        session: shop.owner.session,
        body: {
          youpiBaseUrl: `http://127.0.0.1:${port}`,
          youpiMerchantId: 'M1',
          youpiWebhookSecret: secret,
          upiVpa: 'slc@bank',
          acceptsCard: true,
          acceptsCash: true,
        },
      });

      const ready = async () => {
        const p = await packedOrder(shop, [[1, 1]]);
        const id = { params: { id: p.order.id } };
        await call(counterPackHandler, {
          method: 'POST',
          session: shop.cashier.session,
          ...id,
          body: { qr: p.sticker.qr },
        });
        return id;
      };

      // 1) Webhook path
      const w = await ready();
      const started = staff(
        await call(counterUpiHandler, { method: 'POST', session: shop.cashier.session, ...w }),
      );
      expect(started.counterPayment).toMatchObject({
        status: 'pending',
        payUrl: 'https://pay.example/checkout/1',
      });
      expect(calls[0]).toMatchObject({ method: 'POST', url: '/api/v1/payments' });
      expect(JSON.parse(calls[0]!.body)).toMatchObject({ amount: '200.00', currency: 'INR' });
      expect(calls[0]!.idem).toMatch(/^counter:/);
      const paymentId = started.counterPayment!.reference!;
      const raw = JSON.stringify({
        event: 'SUCCESS',
        paymentId,
        orderId: 'x',
        amount: '200.00',
        amountPaise: 20000,
        currency: 'INR',
        method: 'UPI',
        utr: '123456789012',
      });
      const hook = (sig: string) =>
        youpiWebhookHandler(
          new HttpRequest({
            method: 'POST',
            url: 'http://localhost/api/payments/youpi/SLC01',
            params: { shopCode: 'SLC01' },
            headers: { 'x-gateway-signature': sig },
            body: { string: raw },
          }),
        );
      expect((await hook('sha256=deadbeef')).status).toBe(401);
      const good = `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;
      expect(body<{ outcome: string }>(await hook(good)).outcome).toBe('received');
      expect(body<{ outcome: string }>(await hook(good)).outcome).toBe('duplicate');
      const after = staff(await call(shopOrderHandler, { session: shop.cashier.session, ...w }));
      expect(after).toMatchObject({
        status: 'completed',
        counterPayment: { reference: '123456789012' },
      });

      // 2) Poll path: the server asks the merchant's YouPI-PG directly.
      const pl = await ready();
      await call(counterUpiHandler, { method: 'POST', session: shop.cashier.session, ...pl });
      expect(
        staff(await call(counterPollHandler, { session: shop.cashier.session, ...pl })).status,
      ).toBe('packed');
      status = 'SUCCESS';
      expect(
        staff(await call(counterPollHandler, { session: shop.cashier.session, ...pl })).status,
      ).toBe('completed');
    });
  });
});

describe('shop roles and isolation', () => {
  it('packers cannot confirm, cashiers cannot pack, other shops cannot see the order', async () => {
    const shop = await makeListedShop();
    const other = await makeListedShop('BAL01');
    const { order } = await paidOrder(shop);
    const id = { params: { id: order.id } };
    expect(
      errorCode(
        await call(shopConfirmHandler, { method: 'POST', session: shop.packer.session, ...id }),
      ),
    ).toBe('role_not_allowed');
    await call(shopConfirmHandler, { method: 'POST', session: shop.staff.session, ...id });
    expect(
      errorCode(
        await call(shopStartPackingHandler, {
          method: 'POST',
          session: shop.cashier.session,
          ...id,
        }),
      ),
    ).toBe('role_not_allowed');
    expect((await call(shopOrderHandler, { session: other.owner.session, ...id })).status).toBe(
      404,
    );
    expect((await call(orderHandler, { session: (await makeUser()).session, ...id })).status).toBe(
      404,
    );
  });
});

describe('pickup & arrival assistance workflow', () => {
  it('allows customer to notify arrival and submit assistance request', async () => {
    const shop = await makeListedShop('ARR01');
    const { customer, order } = await paidOrder(shop);

    // 1. Customer marks arrival
    const arrivalRes = await call(ordersArrivalHandler, {
      method: 'POST',
      session: customer.session,
      params: { id: order.id },
      body: { status: 'on_the_way' },
    });
    expect(arrivalRes.status).toBe(200);
    const arrivalOrder = body<CustomerOrder>(arrivalRes);
    expect(arrivalOrder.arrivalStatus).toBe('on_the_way');
    expect(arrivalOrder.arrivalNotifiedAt).toBeTruthy();

    // 2. Customer submits assistance request (bring to car)
    const assistRes = await call(ordersAssistanceHandler, {
      method: 'POST',
      session: customer.session,
      params: { id: order.id },
      body: { type: 'bring_to_car', notes: 'Silver Nexon at Gate 1' },
    });
    expect(assistRes.status).toBe(200);
    const assistOrder = body<CustomerOrder>(assistRes);
    expect(assistOrder.assistanceType).toBe('bring_to_car');
    expect(assistOrder.assistanceNotes).toBe('Silver Nexon at Gate 1');
    expect(assistOrder.assistanceStatus).toBe('pending');
    expect(assistOrder.assistanceRequestedAt).toBeTruthy();

    // 3. Cashier sees the notification on dashboard
    const cashierRes = await call(shopAssistanceRequestsHandler, {
      session: shop.cashier.session,
      headers: { 'x-shop-code': shop.shop.shortCode },
    });
    expect(cashierRes.status).toBe(200);
    const cashierItems = body<CashierAssistanceItem[]>(cashierRes);
    const item = cashierItems.find((i) => i.id === order.id);
    expect(item).toBeTruthy();
    expect(item?.arrivalStatus).toBe('on_the_way');
    expect(item?.assistanceType).toBe('bring_to_car');
    expect(item?.assistanceStatus).toBe('pending');

    // 4. Gate staff does NOT see it before cashier approval
    const gateBefore = await call(gateNotificationsHandler, {
      session: shop.marshal.session,
      headers: { 'x-cluster-id': shop.cluster.id },
    });
    expect(gateBefore.status).toBe(200);
    expect(
      body<GateAssistanceNotification[]>(gateBefore).find((n) => n.id === order.id),
    ).toBeUndefined();

    // 5. Cashier reviews and approves the request
    const reviewRes = await call(shopAssistanceReviewHandler, {
      method: 'POST',
      session: shop.cashier.session,
      params: { id: order.id },
      headers: { 'x-shop-code': shop.shop.shortCode },
      body: { decision: 'approve' },
    });
    expect(reviewRes.status).toBe(200);
    const reviewed = body<CashierAssistanceItem>(reviewRes);
    expect(reviewed.assistanceStatus).toBe('approved');
    expect(reviewed.gateNotificationStatus).toBe('notified');

    // 6. Gate staff receives notification after approval
    const gateAfter = await call(gateNotificationsHandler, {
      session: shop.marshal.session,
      headers: { 'x-cluster-id': shop.cluster.id },
    });
    expect(gateAfter.status).toBe(200);
    const gateNotif = body<GateAssistanceNotification[]>(gateAfter).find((n) => n.id === order.id);
    expect(gateNotif).toBeTruthy();
    expect(gateNotif?.gateNotificationStatus).toBe('notified');
    expect(gateNotif?.assistanceType).toBe('bring_to_car');

    // 7. Gate staff acknowledges notification
    const ackRes = await call(gateAcknowledgeHandler, {
      method: 'POST',
      session: shop.marshal.session,
      params: { id: order.id },
      headers: { 'x-cluster-id': shop.cluster.id },
      body: { notes: 'Marshal standing by at gate' },
    });
    expect(ackRes.status).toBe(200);
    expect(body<GateAssistanceNotification>(ackRes).gateNotificationStatus).toBe('acknowledged');
  });

  it('rejects invalid assistance notes under character limit', async () => {
    const shop = await makeListedShop('ARR02');
    const { customer, order } = await paidOrder(shop);

    const res = await call(ordersAssistanceHandler, {
      method: 'POST',
      session: customer.session,
      params: { id: order.id },
      body: { type: 'other', notes: 'hi' },
    });
    expect(res.status).toBe(400);
  });
});
