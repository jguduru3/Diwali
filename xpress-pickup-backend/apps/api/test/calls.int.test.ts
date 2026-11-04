// Shop → customer calls (G9, amended 2026-11-04): shop staff see the customer's full number and
// call it from their phone's dialer. Each call tap is logged; gate marshals still see it masked.
import { describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { staffOrderSchema, staffOrderSummarySchema } from '@pataka/shared';
import { getDb } from '../src/db/client';
import { auditLog } from '../src/db/schema';
import {
  shopCallCustomerHandler,
  shopOrderHandler,
  shopOrdersHandler,
  shopRejectHandler,
} from '../src/functions/shop';
import { call, errorCode, makeListedShop } from './helpers';
import { paidOrder } from './orderHelpers';

const callOrder = (session: string, id: string) =>
  call(shopCallCustomerHandler, { method: 'POST', session, params: { id } });

describe('shop calls the customer', () => {
  it('shop staff see the full number and get it for the dialer; the call is logged', async () => {
    const shop = await makeListedShop('CAL01');
    const p = await paidOrder(shop);
    const phone = p.customer.user.phoneE164;

    const view = await call(shopOrderHandler, {
      session: shop.packer.session,
      params: { id: p.order.id },
    });
    const order = staffOrderSchema.parse(view.jsonBody);
    expect(order.customer).toBe(phone);
    expect(order.canCall).toBe(true);
    const list = await call(shopOrdersHandler, {
      session: shop.staff.session,
      query: { view: 'incoming' },
    });
    const row = staffOrderSummarySchema.array().parse(list.jsonBody)[0]!;
    expect(row.customer).toBe(phone);

    const res = await callOrder(shop.packer.session, p.order.id);
    expect(res.status).toBe(200);
    expect(res.jsonBody).toEqual({ phone });

    const logged = await getDb()
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, p.order.id), eq(auditLog.action, 'order.call_customer')));
    expect(logged).toHaveLength(1);
    expect(logged[0]!.actorUserId).toBe(shop.packer.user.id);
    expect(JSON.stringify(logged[0]!.meta)).not.toContain(phone.slice(3));
  });

  it('refuses a closed order and another shop’s order', async () => {
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
    const view = await call(shopOrderHandler, {
      session: shop.staff.session,
      params: { id: p.order.id },
    });
    expect(staffOrderSchema.parse(view.jsonBody).canCall).toBe(false);
  });

  it('allows three calls per order in half an hour', async () => {
    const shop = await makeListedShop('CAL04');
    const p = await paidOrder(shop);
    for (let i = 0; i < 3; i++)
      expect((await callOrder(shop.staff.session, p.order.id)).status).toBe(200);
    expect((await callOrder(shop.staff.session, p.order.id)).status).toBe(429);
  });
});
