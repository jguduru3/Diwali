import {
  customerOrderSchema,
  packStickerSchema,
  staffOrderSchema,
  type CustomerOrder,
} from '@pataka/shared';
import { mockCompleteHandler } from '../src/functions/payments';
import { placeOrderHandler, pickupQrHandler } from '../src/functions/orders';
import {
  shopConfirmHandler,
  shopFinishHandler,
  shopScanHandler,
  shopStartPackingHandler,
} from '../src/functions/shop';
import { body, call, makeListedShop, makeUser } from './helpers';

type Shop = Awaited<ReturnType<typeof makeListedShop>>;

/** Places an order (fee_pending) for a new customer. Lines are [itemIndex, qty]. */
export async function placed(
  shop: Shop,
  lines: [number, number][] = [
    [0, 2],
    [1, 1],
  ],
) {
  const customer = await makeUser();
  const res = await call(placeOrderHandler, {
    method: 'POST',
    session: customer.session,
    body: {
      shopCode: shop.shop.shortCode,
      lines: lines.map(([i, qty]) => ({ itemId: shop.items[i]!.id, qty })),
    },
  });
  if (res.status !== 201) throw new Error(`place failed: ${JSON.stringify(res.jsonBody)}`);
  return { customer, order: customerOrderSchema.parse(res.jsonBody) };
}

export async function payFee(
  session: string,
  order: CustomerOrder,
  outcome: 'success' | 'fail' = 'success',
) {
  return call(mockCompleteHandler, {
    method: 'POST',
    session,
    params: { checkoutId: order.fee.checkout!.checkoutId },
    body: { outcome },
  });
}

/** Placed and fee paid (status "placed"). */
export async function paidOrder(shop: Shop, lines?: [number, number][]) {
  const p = await placed(shop, lines);
  await payFee(p.customer.session, p.order);
  return p;
}

/** Paid, confirmed by staff, every unit scanned by the packer and packed. */
export async function packedOrder(
  shop: Shop,
  lines: [number, number][] = [
    [0, 2],
    [1, 1],
  ],
) {
  const p = await paidOrder(shop, lines);
  const id = { params: { id: p.order.id } };
  await call(shopConfirmHandler, { method: 'POST', session: shop.staff.session, ...id });
  await call(shopStartPackingHandler, { method: 'POST', session: shop.packer.session, ...id });
  for (const [i, qty] of lines) {
    for (let n = 0; n < qty; n++) {
      const r = await call(shopScanHandler, {
        method: 'POST',
        session: shop.packer.session,
        ...id,
        body: { barcode: shop.items[i]!.barcode! },
      });
      if (r.status !== 200) throw new Error(`scan failed: ${JSON.stringify(r.jsonBody)}`);
    }
  }
  const fin = await call(shopFinishHandler, {
    method: 'POST',
    session: shop.packer.session,
    ...id,
  });
  const sticker = packStickerSchema.parse(fin.jsonBody);
  const qr = await call(pickupQrHandler, { method: 'POST', session: p.customer.session, ...id });
  return { ...p, sticker, pickupQr: body<{ qr: string }>(qr).qr };
}

export const staff = (res: { jsonBody?: unknown }) => staffOrderSchema.parse(res.jsonBody);
export const cust = (res: { jsonBody?: unknown }) => customerOrderSchema.parse(res.jsonBody);
