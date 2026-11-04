// Shop → customer calls go through a masked bridge (G9): the staff member's own phone rings
// first, then the customer's, and the customer's number never reaches the shop.
import { afterEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { staffOrderSchema } from '@pataka/shared';
import { getDb } from '../src/db/client';
import { auditLog } from '../src/db/schema';
import {
  shopCallCustomerHandler,
  shopOrderHandler,
  shopRejectHandler,
} from '../src/functions/shop';
import { setCallBridgeForTests, type CallBridge } from '../src/lib/calls';
import { call, errorCode, makeListedShop } from './helpers';
import { paidOrder } from './orderHelpers';

const rung: { from: string; to: string }[] = [];
const recorder: CallBridge = {
  name: 'test',
  async connect(from, to) {
    rung.push({ from, to });
  },
};

afterEach(() => {
  rung.length = 0;
  setCallBridgeForTests(null);
  for (const k of [
    'CALL_PROVIDER',
    'EXOTEL_SID',
    'EXOTEL_API_KEY',
    'EXOTEL_API_TOKEN',
    'EXOTEL_CALLER_ID',
  ])
    delete process.env[k];
});

const callOrder = (session: string, id: string) =>
  call(shopCallCustomerHandler, { method: 'POST', session, params: { id } });

describe('shop calls the customer', () => {
  it("rings the staff member's phone, then the customer's, without showing the number", async () => {
    setCallBridgeForTests(recorder);
    const shop = await makeListedShop('CAL01');
    const p = await paidOrder(shop);

    const view = await call(shopOrderHandler, {
      session: shop.packer.session,
      params: { id: p.order.id },
    });
    expect(staffOrderSchema.parse(view.jsonBody).canCall).toBe(true);

    const res = await callOrder(shop.packer.session, p.order.id);
    expect(res.status).toBe(200);
    expect(res.jsonBody).toEqual({ status: 'ringing' });
    expect(rung).toEqual([{ from: shop.packer.user.phoneE164, to: p.customer.user.phoneE164 }]);

    const logged = await getDb()
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, p.order.id), eq(auditLog.action, 'order.call_customer')));
    expect(logged).toHaveLength(1);
    expect(logged[0]!.actorUserId).toBe(shop.packer.user.id);
    expect(JSON.stringify(logged[0]!.meta)).not.toContain(p.customer.user.phoneE164.slice(3));
  });

  it('refuses a closed order and another shop’s order', async () => {
    setCallBridgeForTests(recorder);
    const shop = await makeListedShop('CAL02');
    const other = await makeListedShop('CAL03');
    const p = await paidOrder(shop);
    expect(errorCode(await callOrder(other.staff.session, p.order.id))).toBe('order_not_found');

    await call(shopRejectHandler, {
      method: 'POST',
      session: shop.staff.session,
      params: { id: p.order.id },
      body: { reason: 'Closed today' },
    });
    const closed = await callOrder(shop.staff.session, p.order.id);
    expect(closed.status).toBe(409);
    expect(errorCode(closed)).toBe('bad_state');
    expect(rung).toHaveLength(0);
  });

  it('allows three tries per order in half an hour', async () => {
    setCallBridgeForTests(recorder);
    const shop = await makeListedShop('CAL04');
    const p = await paidOrder(shop);
    for (let i = 0; i < 3; i++)
      expect((await callOrder(shop.staff.session, p.order.id)).status).toBe(200);
    expect((await callOrder(shop.staff.session, p.order.id)).status).toBe(429);
    expect(rung).toHaveLength(3);
  });

  it('hides the button and refuses calls when calling is off', async () => {
    process.env.CALL_PROVIDER = 'off';
    const shop = await makeListedShop('CAL05');
    const p = await paidOrder(shop);
    const view = await call(shopOrderHandler, {
      session: shop.staff.session,
      params: { id: p.order.id },
    });
    expect(staffOrderSchema.parse(view.jsonBody).canCall).toBe(false);
    expect(errorCode(await callOrder(shop.staff.session, p.order.id))).toBe('calls_off');
  });

  it('treats Exotel without its keys (Key Vault "not-set") as off, not as a failing call', async () => {
    process.env.CALL_PROVIDER = 'exotel';
    Object.assign(process.env, {
      EXOTEL_SID: 'sid',
      EXOTEL_API_KEY: 'key',
      EXOTEL_API_TOKEN: 'not-set',
      EXOTEL_CALLER_ID: '08000000000',
    });
    const shop = await makeListedShop('CAL06');
    const p = await paidOrder(shop);
    const view = await call(shopOrderHandler, {
      session: shop.staff.session,
      params: { id: p.order.id },
    });
    expect(staffOrderSchema.parse(view.jsonBody).canCall).toBe(false);
    expect(errorCode(await callOrder(shop.staff.session, p.order.id))).toBe('calls_off');
  });
});
