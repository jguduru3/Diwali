import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PushPayload } from '@pataka/shared';
import { getDb } from '../src/db/client';
import { pushOutbox, pushSubscriptions } from '../src/db/schema';
import { deleteMeHandler } from '../src/functions/me';
import { cancelHandler, decisionHandler } from '../src/functions/orders';
import {
  pushKeyHandler,
  pushSubscribeHandler,
  pushTestHandler,
  pushUnsubscribeHandler,
} from '../src/functions/push';
import {
  counterCashHandler,
  counterOpenHandler,
  counterPackHandler,
  shopConfirmHandler,
  shopOutOfStockHandler,
  shopRejectHandler,
  shopStartPackingHandler,
} from '../src/functions/shop';
import { drainOutbox, setPushSender, type PushResult } from '../src/lib/push';
import { body, call, errorCode, makeListedShop, makeUser } from './helpers';
import { packedOrder, paidOrder, placed } from './orderHelpers';

type Sent = { endpoint: string; payload: PushPayload };
let sent: Sent[] = [];
let result: PushResult = 'sent';
let restore: () => void;

beforeEach(() => {
  sent = [];
  result = 'sent';
  restore = setPushSender(async (sub, payload) => {
    sent.push({ endpoint: sub.endpoint, payload });
    return result;
  });
});
afterEach(() => restore());

const KEYS = {
  p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM',
  auth: 'tBHItJI5svbpez7KI4CCXg',
};

async function subscribe(session: string, app: 'customer' | 'merchant', tag: string, lang = 'en') {
  const res = await call(pushSubscribeHandler, {
    method: 'POST',
    session,
    body: { endpoint: `https://push.example.test/${tag}`, keys: KEYS, app, lang },
  });
  expect(res.status).toBe(201);
}

const kinds = (endpoint: string) =>
  sent.filter((s) => s.endpoint.endsWith(endpoint)).map((s) => s.payload.kind);

describe('push subscriptions', () => {
  it('needs a signed-in user and a strict, https body', async () => {
    const res = await call(pushSubscribeHandler, {
      method: 'POST',
      body: { endpoint: 'https://push.example.test/x', keys: KEYS, app: 'customer', lang: 'en' },
    });
    expect(res.status).toBe(401);
    const { session } = await makeUser();
    const insecure = await call(pushSubscribeHandler, {
      method: 'POST',
      session,
      body: { endpoint: 'http://push.example.test/x', keys: KEYS, app: 'customer', lang: 'en' },
    });
    expect(errorCode(insecure)).toBe('invalid_body');
    const extra = await call(pushSubscribeHandler, {
      method: 'POST',
      session,
      body: {
        endpoint: 'https://push.example.test/x',
        keys: KEYS,
        app: 'customer',
        lang: 'en',
        phone: '+919999999999',
      },
    });
    expect(errorCode(extra)).toBe('invalid_body');
  });

  it('returns no public key when VAPID is not configured', async () => {
    expect(body<{ publicKey: string | null }>(await pushKeyHandler()).publicKey).toBeNull();
  });

  it('an endpoint moves to whoever subscribes with it last; unsubscribe removes it', async () => {
    const a = await makeUser();
    const b = await makeUser();
    await subscribe(a.session, 'customer', 'shared');
    await subscribe(b.session, 'customer', 'shared');
    const rows = await getDb().select().from(pushSubscriptions);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.userId).toBe(b.user.id);

    await call(pushUnsubscribeHandler, {
      method: 'POST',
      session: b.session,
      body: { endpoint: 'https://push.example.test/shared' },
    });
    expect(await getDb().select().from(pushSubscriptions)).toHaveLength(0);
  });

  it('sends a test notification to the caller only, in their language', async () => {
    const a = await makeUser();
    await subscribe(a.session, 'customer', 'mine', 'te');
    await subscribe((await makeUser()).session, 'customer', 'theirs');
    await call(pushTestHandler, { method: 'POST', session: a.session, body: { app: 'customer' } });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.payload).toMatchObject({ kind: 'test', lang: 'te', url: '/orders' });
  });

  it('delete-me removes the person’s devices', async () => {
    const a = await makeUser();
    await subscribe(a.session, 'customer', 'gone');
    await call(deleteMeHandler, { method: 'DELETE', session: a.session });
    expect(await getDb().select().from(pushSubscriptions)).toHaveLength(0);
  });
});

describe('order notifications', () => {
  it('tells the shop about a new paid order and the customer about each step, without personal data', async () => {
    const shop = await makeListedShop();
    await subscribe(shop.owner.session, 'merchant', 'owner');
    await subscribe(shop.staff.session, 'merchant', 'staff');
    await subscribe(shop.cashier.session, 'merchant', 'cashier');
    // The order is placed by a new customer inside packedOrder; subscribe them as soon as we can.
    const p = await placed(shop);
    await subscribe(p.customer.session, 'customer', 'cust');
    expect(sent).toHaveLength(0); // fee not paid yet: nobody hears about it

    const { payFee } = await import('./orderHelpers');
    await payFee(p.customer.session, p.order);
    expect(kinds('owner')).toEqual(['new_order']);
    expect(kinds('staff')).toEqual(['new_order']);
    expect(kinds('cashier')).toEqual([]); // cashiers don't take orders
    const n = sent.find((s) => s.endpoint.endsWith('owner'))!.payload;
    expect(n.url).toBe('/shop');
    expect(n.params).toMatchObject({ shop: shop.shop.name, code: expect.any(String) });
    expect(JSON.stringify(sent)).not.toMatch(/\+91|phone/i);

    const id = { params: { id: p.order.id } };
    await call(shopConfirmHandler, { method: 'POST', session: shop.staff.session, ...id });
    expect(kinds('cust')).toEqual(['order_confirmed']);
    expect(sent.at(-1)!.payload.url).toBe(`/orders/${p.order.id}`);
  });

  it('asks the customer when an item is out of stock and tells the packer when they answer', async () => {
    const shop = await makeListedShop();
    await subscribe(shop.packer.session, 'merchant', 'packer');
    const p = await paidOrder(shop);
    await subscribe(p.customer.session, 'customer', 'cust');
    const id = { params: { id: p.order.id } };
    await call(shopConfirmHandler, { method: 'POST', session: shop.staff.session, ...id });
    await call(shopStartPackingHandler, { method: 'POST', session: shop.packer.session, ...id });
    const lineId = p.order.lines[1]!.id;
    await call(shopOutOfStockHandler, {
      method: 'POST',
      session: shop.packer.session,
      ...id,
      body: { lineId },
    });
    expect(kinds('cust')).toEqual(['order_confirmed', 'order_needs_answer']);
    await call(decisionHandler, {
      method: 'POST',
      session: p.customer.session,
      ...id,
      body: { lineId, decision: 'remove' },
    });
    expect(kinds('packer')).toEqual(['customer_answered']);
    expect(sent.at(-1)!.payload.url).toBe('/shop/packing');
  });

  it('tells the customer the pack number when packed and the bill number when paid', async () => {
    const shop = await makeListedShop();
    const q = await packedOrder(shop);
    // Queued even before this phone subscribed: confirmed, then packed with the pack number.
    const queued = await getDb()
      .select()
      .from(pushOutbox)
      .where(eq(pushOutbox.userId, q.customer.user.id))
      .orderBy(pushOutbox.createdAt);
    expect(queued.map((r) => r.kind)).toEqual(['order_confirmed', 'order_packed']);
    expect(queued[1]!.params).toMatchObject({ packNo: q.sticker.packNo });
    await subscribe(q.customer.session, 'customer', 'cust2');
    await call(counterOpenHandler, {
      method: 'POST',
      session: shop.cashier.session,
      body: { qr: q.pickupQr },
    });
    await call(counterPackHandler, {
      method: 'POST',
      session: shop.cashier.session,
      params: { id: q.order.id },
      body: { qr: q.sticker.qr },
    });
    const cash = await call(counterCashHandler, {
      method: 'POST',
      session: shop.cashier.session,
      params: { id: q.order.id },
      body: { receivedPaise: 100000 },
    });
    expect(cash.status).toBe(200);
    const done = sent.filter((s) => s.endpoint.endsWith('cust2'));
    expect(done.map((s) => s.payload.kind)).toEqual(['order_completed']);
    expect(done[0]!.payload.params.billNo).toBeTruthy();
  });

  it('tells the customer when the shop rejects; not when they cancel themselves', async () => {
    const shop = await makeListedShop();
    const a = await paidOrder(shop);
    await subscribe(a.customer.session, 'customer', 'a');
    await call(shopRejectHandler, {
      method: 'POST',
      session: shop.staff.session,
      params: { id: a.order.id },
      body: { reason: 'Closed today' },
    });
    expect(kinds('a')).toEqual(['order_rejected']);

    const b = await paidOrder(shop);
    await subscribe(b.customer.session, 'customer', 'b');
    const res = await call(cancelHandler, {
      method: 'POST',
      session: b.customer.session,
      params: { id: b.order.id },
      body: {},
    });
    expect(res.status).toBe(200);
    expect(kinds('b')).toEqual([]);
  });

  it('forgets subscriptions the push service says are gone, and retries failures later', async () => {
    const shop = await makeListedShop();
    await subscribe(shop.owner.session, 'merchant', 'owner');
    result = 'gone';
    await paidOrder(shop);
    expect(await getDb().select().from(pushSubscriptions)).toHaveLength(0);

    await subscribe(shop.owner.session, 'merchant', 'owner');
    result = 'failed';
    await paidOrder(shop);
    const [pending] = await getDb()
      .select()
      .from(pushOutbox)
      .where(eq(pushOutbox.userId, shop.owner.user.id))
      .orderBy(pushOutbox.createdAt);
    expect(pending).toBeDefined();
    result = 'sent';
    sent = [];
    expect(await drainOutbox(getDb())).toBe(1);
    expect(kinds('owner')).toEqual(['new_order']);
    // Nothing older than an hour is sent late.
    result = 'failed';
    await paidOrder(shop);
    result = 'sent';
    sent = [];
    expect(await drainOutbox(getDb(), new Date(Date.now() + 2 * 3600_000))).toBe(0);
    expect(sent).toHaveLength(0);
  });
});
