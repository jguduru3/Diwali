// GST tax invoice for the customer's ₹30 platform fee: numbered when the fee is paid (XPF),
// SAC 996211, ₹25.42 taxable + ₹2.29 CGST + ₹2.29 SGST; only the customer can open it.
import { describe, expect, it } from 'vitest';
import { customerOrderSchema, taxInvoiceSchema } from '@pataka/shared';
import { getDb } from '../src/db/client';
import { merchantSubscriptions } from '../src/db/schema';
import { feeInvoiceHandler, orderHandler } from '../src/functions/orders';
import { shopInvoicesHandler } from '../src/functions/shop';
import { call, errorCode, makeListedShop, makeUser } from './helpers';
import { paidOrder, placed } from './orderHelpers';

describe('platform fee tax invoice', () => {
  it('is issued when the fee is paid and shows the GST inside the ₹30', async () => {
    const shop = await makeListedShop('INV01');
    const p = await paidOrder(shop);

    const order = customerOrderSchema.parse(
      (await call(orderHandler, { session: p.customer.session, params: { id: p.order.id } }))
        .jsonBody,
    );
    expect(order.fee.invoiceNo).toMatch(/^XPF\/\d{4}\/\d{6}$/);

    const res = await call(feeInvoiceHandler, {
      session: p.customer.session,
      params: { id: p.order.id },
    });
    expect(res.status).toBe(200);
    const inv = taxInvoiceSchema.parse(res.jsonBody);
    expect(inv).toMatchObject({
      kind: 'platform_fee',
      invoiceNo: order.fee.invoiceNo,
      ratePercent: 18,
      taxablePaise: 2542,
      cgstPaise: 229,
      sgstPaise: 229,
      totalPaise: 3000,
      refunded: false,
      supplier: { name: 'Better Analytics Private Limited', stateCode: '36' },
      recipient: { phone: p.customer.user.phoneE164 },
    });
    expect(inv.lines).toEqual([
      expect.objectContaining({ sac: '996211', qty: 1, taxablePaise: 2542 }),
    ]);
    expect(inv.invoiceNo.length).toBeLessThanOrEqual(16);
  });

  it('numbers each paid fee once, in sequence', async () => {
    const shop = await makeListedShop('INV02');
    const a = await paidOrder(shop);
    const b = await paidOrder(shop);
    const no = async (o: typeof a) =>
      taxInvoiceSchema.parse(
        (await call(feeInvoiceHandler, { session: o.customer.session, params: { id: o.order.id } }))
          .jsonBody,
      ).invoiceNo;
    const [x, y] = [await no(a), await no(b)];
    expect(x).not.toBe(y);
    expect(Number(y.split('/')[2])).toBeGreaterThan(Number(x.split('/')[2]));
    expect(await no(a)).toBe(x);
  });

  it('none before the fee is paid, and nobody else can open it', async () => {
    const shop = await makeListedShop('INV03');
    const unpaid = await placed(shop);
    const early = await call(feeInvoiceHandler, {
      session: unpaid.customer.session,
      params: { id: unpaid.order.id },
    });
    expect(errorCode(early)).toBe('no_invoice');

    const p = await paidOrder(shop);
    const stranger = await makeUser();
    const other = await call(feeInvoiceHandler, {
      session: stranger.session,
      params: { id: p.order.id },
    });
    expect(errorCode(other)).toBe('order_not_found');
  });
});

describe('subscription tax invoice', () => {
  it('shows what was charged: a subscription paid at the earlier ₹1,999 + GST stays as it was', async () => {
    const shop = await makeListedShop('INV04');
    await getDb()
      .insert(merchantSubscriptions)
      .values({
        shopId: shop.shop.id,
        season: '2026',
        amountPaise: 199_900,
        gstPaise: 36_000,
        status: 'paid',
        method: 'offline',
        invoiceNo: 'DXE/2026/900001',
        paidAt: new Date('2026-11-01T10:00:00+05:30'),
      });
    const res = await call(shopInvoicesHandler, { session: shop.owner.session });
    const [inv] = taxInvoiceSchema.array().parse(res.jsonBody);
    expect(inv).toMatchObject({
      kind: 'subscription',
      invoiceNo: 'DXE/2026/900001',
      taxablePaise: 199_900,
      cgstPaise: 18_000,
      sgstPaise: 18_000,
      totalPaise: 235_900,
    });
    expect(errorCode(await call(shopInvoicesHandler, { session: shop.staff.session }))).toBe(
      'owner_only',
    );
  });
});
