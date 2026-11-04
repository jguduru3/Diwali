// The behaviours added for the Xpress Pickup release: customer SMS on order changes, unpaid
// order expiry, the configurable platform fee, the box-open photo, packs across shops and
// the agent induction requirement.
import { afterEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { INDUCTION_VERSION, customerOrderSchema } from '@pataka/shared';
import { getDb } from '../src/db/client';
import { items, orderEvents, orders } from '../src/db/schema';
import { orderingInfoHandler, placeOrderHandler } from '../src/functions/orders';
import {
  shopConfirmHandler,
  shopItemImageHandler,
  shopOutOfStockHandler,
  shopStartPackingHandler,
} from '../src/functions/shop';
import { agentRegisterHandler, kitOffersHandler } from '../src/functions/growth';
import { notifyOrderChanged } from '../src/lib/customerNotify';
import { expireUnpaid } from '../src/lib/orders';
import { setSmsSenderForTests, type SmsSender } from '../src/lib/sms';
import { body, call, errorCode, makeListedShop, makeUser } from './helpers';
import { paidOrder, placed } from './orderHelpers';

const sent: { phone: string; template: string; vars: Record<string, string> }[] = [];
const recorder: SmsSender = {
  name: 'test',
  async send(phone, template, vars) {
    sent.push({ phone, template, vars });
  },
};

afterEach(() => {
  sent.length = 0;
  setSmsSenderForTests(null);
  delete process.env.PLATFORM_FEE_PAISE;
  delete process.env.UNPAID_ORDER_TTL_MINUTES;
  delete process.env.ORDER_CHANGED_SMS_GAP_MINUTES;
});

async function packingOrder(code: string) {
  const shop = await makeListedShop(code);
  const p = await paidOrder(shop, [
    [0, 1],
    [1, 1],
  ]);
  const id = { params: { id: p.order.id } };
  await call(shopConfirmHandler, { method: 'POST', session: shop.staff.session, ...id });
  await call(shopStartPackingHandler, { method: 'POST', session: shop.packer.session, ...id });
  return { shop, ...p, id };
}

const events = async (orderId: string, type: string) =>
  getDb()
    .select()
    .from(orderEvents)
    .where(and(eq(orderEvents.orderId, orderId), eq(orderEvents.type, type)));

describe('customer told when a shop changes the order', () => {
  it('out of stock sends one SMS with the shop, order code and link, and records it', async () => {
    setSmsSenderForTests(recorder);
    const { shop, order, id, customer } = await packingOrder('NT01');
    const res = await call(shopOutOfStockHandler, {
      method: 'POST',
      session: shop.packer.session,
      ...id,
      body: { lineId: order.lines[0]!.id },
    });
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      phone: customer.user.phoneE164,
      template: 'order_changed',
      vars: { shop: 'Shop NT01', code: order.code },
    });
    expect(sent[0]!.vars.link).toMatch(new RegExp(`/orders/${order.id}$`));
    expect(await events(order.id, 'customer_notified')).toHaveLength(1);

    // a second change in the same window does not send another SMS
    await call(shopOutOfStockHandler, {
      method: 'POST',
      session: shop.packer.session,
      ...id,
      body: { lineId: order.lines[1]!.id },
    });
    expect(sent).toHaveLength(1);
  });

  it('a failed SMS is recorded and does not block packing', async () => {
    setSmsSenderForTests({
      name: 'broken',
      async send() {
        throw new Error('provider down');
      },
    });
    const { shop, order, id } = await packingOrder('NT02');
    const res = await call(shopOutOfStockHandler, {
      method: 'POST',
      session: shop.packer.session,
      ...id,
      body: { lineId: order.lines[0]!.id },
    });
    expect(res.status).toBe(200);
    expect(await events(order.id, 'customer_notify_failed')).toHaveLength(1);
  });

  it('nothing is sent for an order that is not waiting for the customer', async () => {
    setSmsSenderForTests(recorder);
    const { order } = await packingOrder('NT03');
    expect(await notifyOrderChanged(getDb(), order.id)).toBe('skipped_status');
    expect(sent).toHaveLength(0);
  });
});

describe('unpaid orders expire', () => {
  it('cancels orders still waiting for the fee after the time limit, not paid ones', async () => {
    process.env.UNPAID_ORDER_TTL_MINUTES = '30';
    const shop = await makeListedShop('UP01');
    const unpaid = await placed(shop, [[0, 1]]);
    const paid = await paidOrder(shop, [[1, 1]]);
    // not yet due
    expect(await expireUnpaid(getDb(), new Date(Date.now() + 10 * 60_000))).toBe(0);
    // 31 minutes later
    expect(await expireUnpaid(getDb(), new Date(Date.now() + 31 * 60_000))).toBe(1);
    const [u] = await getDb().select().from(orders).where(eq(orders.id, unpaid.order.id));
    const [pd] = await getDb().select().from(orders).where(eq(orders.id, paid.order.id));
    expect(u!.status).toBe('cancelled');
    expect(u!.cancelReason).toBe('Platform fee not paid in time');
    expect(pd!.status).toBe('placed');
  });
});

describe('platform fee comes from settings', () => {
  it('a new order and the ordering info use PLATFORM_FEE_PAISE', async () => {
    process.env.PLATFORM_FEE_PAISE = '2500';
    const info = await call(orderingInfoHandler, {});
    expect(body<{ feePaise: number }>(info).feePaise).toBe(2500);
    const shop = await makeListedShop('FE01');
    const customer = await makeUser();
    const res = await call(placeOrderHandler, {
      method: 'POST',
      session: customer.session,
      body: { shopCode: 'FE01', lines: [{ itemId: shop.items[0]!.id, qty: 1 }] },
    });
    expect(customerOrderSchema.parse(res.jsonBody).fee.amountPaise).toBe(2500);
  });

  it('an invalid fee setting is refused, not silently used', async () => {
    process.env.PLATFORM_FEE_PAISE = 'thirty';
    const info = await call(orderingInfoHandler, {});
    expect(info.status).toBe(500);
  });
});

describe('two photos per product', () => {
  // smallest valid PNG (1×1), padded so the upload passes the size floor
  const png =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  it('the box-open photo is stored separately from the box-closed one', async () => {
    const shop = await makeListedShop('PH01');
    const item = shop.items[0]!;
    const up = (side: 'closed' | 'open') =>
      call(shopItemImageHandler, {
        method: 'POST',
        session: shop.owner.session,
        params: { id: item.id },
        body: { contentType: 'image/png', base64: png.padEnd(120, '='), side },
      });
    const closed = body<{ imageUrl: string; imageOpenUrl: string | null }>(await up('closed'));
    expect(closed.imageUrl).toMatch(/^\/api\/media\//);
    expect(closed.imageOpenUrl).toBeNull();
    const both = body<{ imageUrl: string; imageOpenUrl: string | null }>(await up('open'));
    expect(both.imageOpenUrl).toMatch(/^\/api\/media\//);
    expect(both.imageOpenUrl).not.toBe(both.imageUrl);
    const [row] = await getDb().select().from(items).where(eq(items.id, item.id));
    expect(row!.imagePath).toBeTruthy();
    expect(row!.imageOpenPath).toBeTruthy();
  });
});

describe('packs across shops', () => {
  it('each offer carries the shop’s item number and price version for the order list', async () => {
    const shop = await makeListedShop('KT01');
    await getDb()
      .update(items)
      .set({
        kind: 'kit',
        kitType: 'kids',
        contents: [{ name: 'Sparklers', qty: 10 }],
        imagePath: null,
      })
      .where(eq(items.id, shop.items[0]!.id));
    const res = await call(kitOffersHandler, { params: { type: 'kids' } });
    const offers = body<{ shopCode: string; itemNo: number; priceVersion: number }[]>(res);
    const mine = offers.find((o) => o.shopCode === 'KT01');
    expect(mine).toMatchObject({ itemNo: shop.items[0]!.itemNo, priceVersion: 1 });
  });
});

describe('agent induction', () => {
  it('registering without the current induction version is refused', async () => {
    const u = await makeUser();
    const res = await call(agentRegisterHandler, {
      method: 'POST',
      session: u.session,
      body: { name: 'Test Agent', upiId: 'testagent@okaxis', acceptTerms: true },
    });
    expect(res.status).toBe(400);
    const old = await call(agentRegisterHandler, {
      method: 'POST',
      session: u.session,
      body: {
        name: 'Test Agent',
        upiId: 'testagent@okaxis',
        acceptTerms: true,
        inductionVersion: '2020-01-v0',
      },
    });
    expect(old.status).toBe(400);
    const ok = await call(agentRegisterHandler, {
      method: 'POST',
      session: u.session,
      body: {
        name: 'Test Agent',
        upiId: 'testagent@okaxis',
        acceptTerms: true,
        inductionVersion: INDUCTION_VERSION,
      },
    });
    expect([200, 201]).toContain(ok.status);
    expect(errorCode(ok)).toBeUndefined();
  });
});
