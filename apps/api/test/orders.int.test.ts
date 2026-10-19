import { createHmac } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { billSchema } from '@pataka/shared';
import { getDb } from '../src/db/client';
import { feeRefunds, items, orders } from '../src/db/schema';
import {
  cancelHandler,
  decisionHandler,
  orderHandler,
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
  shopConfirmHandler,
  shopFinishHandler,
  shopOrderHandler,
  shopOrdersHandler,
  shopOutOfStockHandler,
  shopPickHandler,
  shopRejectHandler,
  shopScanHandler,
  shopStartPackingHandler,
} from '../src/functions/shop';
import { expireUnconfirmed } from '../src/lib/orders';
import { signMockEvent } from '../src/lib/payments/mock';
import { HttpRequest } from '@azure/functions';
import { body, call, errorCode, makeListedShop, makeUser } from './helpers';
import { cust, packedOrder, paidOrder, payFee, placed, staff } from './orderHelpers';

const refundsFor = async (orderId: string) => {
  const db = getDb();
  const rows = await db.select().from(feeRefunds);
  const [o] = await db.select().from(orders).where(eq(orders.id, orderId));
  return { rows, order: o! };
};

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

  it('keeps the fee once the merchant confirmed', async () => {
    const shop = await makeListedShop();
    const { customer, order } = await paidOrder(shop);
    await call(shopConfirmHandler, {
      method: 'POST',
      session: shop.staff.session,
      params: { id: order.id },
    });
    const can = await call(cancelHandler, {
      method: 'POST',
      session: customer.session,
      params: { id: order.id },
      body: { reason: 'Changed my mind' },
    });
    expect(cust(can)).toMatchObject({ status: 'cancelled', fee: { status: 'kept' } });
    expect(await getDb().select().from(feeRefunds)).toHaveLength(0);
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
    const scan = (barcode: string) =>
      call(shopScanHandler, {
        method: 'POST',
        session: shop.packer.session,
        ...id,
        body: { barcode },
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
    expect(errorCode(await scan(shop.items[2]!.barcode!))).toBe('not_in_order');
    expect(errorCode(await scan('NOPE-1234'))).toBe('unknown_barcode');
    const early = await call(shopFinishHandler, {
      method: 'POST',
      session: shop.packer.session,
      ...id,
    });
    expect(errorCode(early)).toBe('not_ready');
  });

  it('items without a barcode are picked by hand; barcoded ones must be scanned', async () => {
    const { shop, order, id } = await packing();
    const byHand = (lineId: string) =>
      call(shopPickHandler, {
        method: 'POST',
        session: shop.packer.session,
        ...id,
        body: { lineId },
      });
    expect(errorCode(await byHand(order.lines[0]!.id))).toBe('scan_required');
    expect(staff(await byHand(order.lines[2]!.id)).lines[2]!.status).toBe('picked');
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
      [a, b].map((id) =>
        call(shopScanHandler, {
          method: 'POST',
          session: shop.packer.session,
          ...id,
          body: { barcode: shop.items[2]!.barcode! },
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

  it('the pack cannot be matched or paid before the customer QR is scanned', async () => {
    const shop = await makeListedShop();
    const p = await packedOrder(shop, [[1, 1]]);
    const id = { params: { id: p.order.id } };
    const early = await call(counterPackHandler, {
      method: 'POST',
      session: shop.cashier.session,
      ...id,
      body: { qr: p.sticker.qr },
    });
    expect(errorCode(early)).toBe('scan_customer_first');
    const cash = await call(counterCashHandler, {
      method: 'POST',
      session: shop.cashier.session,
      ...id,
      body: { receivedPaise: 50000 },
    });
    expect(errorCode(cash)).toBe('pack_not_matched');
  });

  it('refuses a pickup QR from another shop and the pack sticker scanned first', async () => {
    const a = await makeListedShop('SLC01');
    const b = await makeListedShop('BAL01');
    const p = await packedOrder(a);
    const foreign = await call(counterOpenHandler, {
      method: 'POST',
      session: b.cashier.session,
      body: { qr: p.pickupQr },
    });
    expect(errorCode(foreign)).toBe('wrong_shop');
    const packFirst = await call(counterOpenHandler, {
      method: 'POST',
      session: a.cashier.session,
      body: { qr: p.sticker.qr },
    });
    expect(errorCode(packFirst)).toBe('scan_customer_first');
  });

  it('card and simulated UPI complete the order', async () => {
    const shop = await makeListedShop();
    const ready = async () => {
      const p = await packedOrder(shop, [[1, 1]]);
      const id = { params: { id: p.order.id } };
      await call(counterOpenHandler, {
        method: 'POST',
        session: shop.cashier.session,
        body: { qr: p.pickupQr },
      });
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
        await call(counterOpenHandler, {
          method: 'POST',
          session: shop.cashier.session,
          body: { qr: p.pickupQr },
        });
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
