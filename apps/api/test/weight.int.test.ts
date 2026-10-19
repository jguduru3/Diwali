import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { billSchema } from '@pataka/shared';
import { getDb } from '../src/db/client';
import { items } from '../src/db/schema';
import { decisionHandler, placeOrderHandler } from '../src/functions/orders';
import {
  counterCashHandler,
  counterOpenHandler,
  counterPackHandler,
  shopConfirmHandler,
  shopFinishHandler,
  shopScanHandler,
  shopStartPackingHandler,
  shopWeighHandler,
} from '../src/functions/shop';
import { call, errorCode, makeListedShop, makeUser, body } from './helpers';
import { cust, payFee, staff } from './orderHelpers';
import { pickupQrHandler } from '../src/functions/orders';

/** A listed shop plus a per-kg item (₹600/kg, 5 kg stock) and a mix box (₹700/kg). */
async function weighedShop() {
  const shop = await makeListedShop();
  const db = getDb();
  const [kg] = await db
    .insert(items)
    .values({
      shopId: shop.shop.id,
      itemNo: 10,
      categoryId: shop.allowedCategory.id,
      nameEn: 'Loose flower pots',
      pricePaise: 60000,
      saleUnit: 'kg',
      stockQty: 5000,
      barcode: 'BCKG-1',
      greenCert: 'CSIR_NEERI_SWAS',
      greenRef: 'REF-KG',
    })
    .returning();
  const [mix] = await db
    .insert(items)
    .values({
      shopId: shop.shop.id,
      itemNo: 11,
      categoryId: shop.allowedCategory.id,
      nameEn: 'Mix box',
      pricePaise: 70000,
      saleUnit: 'mix_kg',
      greenCert: 'CSIR_NEERI_SWAS',
      greenRef: 'REF-MIX',
    })
    .returning();
  return { ...shop, kg: kg!, mix: mix! };
}

async function place(shopCode: string, lines: object[]) {
  const customer = await makeUser();
  const res = await call(placeOrderHandler, {
    method: 'POST',
    session: customer.session,
    body: { shopCode, lines },
  });
  return { customer, res };
}

describe('ordering by weight', () => {
  it('prices per-kg and mix lines from grams; mix keeps the chosen items', async () => {
    const s = await weighedShop();
    const { res } = await place('SLC01', [
      { itemId: s.kg.id, grams: 1500 },
      { itemId: s.mix.id, grams: 2000, mixItemIds: [s.items[0]!.id, s.items[1]!.id] },
      { itemId: s.items[0]!.id, qty: 1 },
    ]);
    expect(res.status).toBe(201);
    const order = cust(res);
    expect(order.estimatedTotalPaise).toBe(90000 + 140000 + 10000);
    expect(order.lines[0]).toMatchObject({
      saleUnit: 'kg',
      qty: 1,
      orderedGrams: 1500,
      unitPricePaise: 60000,
    });
    expect(order.lines[1]!.mixItems.map((m) => m.nameEn)).toEqual(['Item 1', 'Item 2']);
  });

  it('refuses grams for pack items, qty for weighed items, mixes without items, and too much stock', async () => {
    const s = await weighedShop();
    const code = async (lines: object[]) => errorCode((await place('SLC01', lines)).res);
    expect(await code([{ itemId: s.items[0]!.id, grams: 500 }])).toBe('not_sold_by_weight');
    expect(await code([{ itemId: s.kg.id, qty: 2 }])).toBe('sold_by_weight');
    expect(await code([{ itemId: s.mix.id, grams: 1000 }])).toBe('mix_needs_items');
    expect(await code([{ itemId: s.kg.id, grams: 1000, mixItemIds: [s.items[0]!.id] }])).toBe(
      'not_a_mix',
    );
    expect(await code([{ itemId: s.mix.id, grams: 1000, mixItemIds: [s.mix.id] }])).toBe(
      'item_unavailable',
    );
    expect(await code([{ itemId: s.kg.id, grams: 6000 }])).toBe('not_enough_stock');
    expect(await code([{ itemId: s.kg.id, grams: 1234 }])).toBe('invalid_body');
  });
});

describe('packing by weight', () => {
  type Shop = Awaited<ReturnType<typeof weighedShop>>;
  async function packing(lines: (s: Shop) => object[]) {
    const s = await weighedShop();
    const { customer, res } = await place('SLC01', lines(s));
    const order = cust(res);
    await payFee(customer.session, order);
    const id = { params: { id: order.id } };
    await call(shopConfirmHandler, { method: 'POST', session: s.staff.session, ...id });
    await call(shopStartPackingHandler, { method: 'POST', session: s.packer.session, ...id });
    const weigh = (lineId: string, grams: number) =>
      call(shopWeighHandler, {
        method: 'POST',
        session: s.packer.session,
        ...id,
        body: { lineId, grams },
      });
    const finish = () =>
      call(shopFinishHandler, { method: 'POST', session: s.packer.session, ...id });
    const decide = (lineId: string, decision: 'accept' | 'decline' | 'remove') =>
      call(decisionHandler, {
        method: 'POST',
        session: customer.session,
        ...id,
        body: { lineId, decision },
      });
    return { s, customer, order, id, weigh, finish, decide };
  }

  it('within ±10 % is packed at the weighed amount, stock drops by grams, bill is by weight', async () => {
    const p = await packing((s) => [{ itemId: s.kg.id, grams: 2000 }]);
    const line = p.order.lines[0]!.id;
    expect(staff(await p.weigh(line, 2150)).lines[0]).toMatchObject({
      status: 'picked',
      packedGrams: 2150,
    });
    const [kg] = await getDb().select().from(items).where(eq(items.id, p.s.kg.id));
    expect(kg!.stockQty).toBe(5000 - 2150);
    const sticker = body<{ qr: string; packNo: number }>(await p.finish());

    // Counter: bill uses 2.15 kg × ₹600/kg = ₹1,290.
    const qr = body<{ qr: string }>(
      await call(pickupQrHandler, { method: 'POST', session: p.customer.session, ...p.id }),
    ).qr;
    const open = staff(
      await call(counterOpenHandler, {
        method: 'POST',
        session: p.s.cashier.session,
        body: { qr },
      }),
    );
    expect(open.finalTotalPaise).toBe(129000);
    await call(counterPackHandler, {
      method: 'POST',
      session: p.s.cashier.session,
      ...p.id,
      body: { qr: sticker.qr },
    });
    const paid = staff(
      await call(counterCashHandler, {
        method: 'POST',
        session: p.s.cashier.session,
        ...p.id,
        body: { receivedPaise: 130000 },
      }),
    );
    expect(billSchema.parse(paid.bill).lines[0]).toMatchObject({
      grams: 2150,
      unitPricePaise: 60000,
      totalPaise: 129000,
    });
  });

  it('outside ±10 % waits for the customer: accept bills the weighed amount', async () => {
    const p = await packing((s) => [{ itemId: s.kg.id, grams: 2000 }]);
    const line = p.order.lines[0]!.id;
    const w = staff(await p.weigh(line, 2500));
    expect(w.status).toBe('awaiting_customer');
    expect(w.lines[0]).toMatchObject({ status: 'weight_proposed', proposedGrams: 2500 });
    expect((await p.finish()).status).toBe(409);
    const accepted = cust(await p.decide(line, 'accept'));
    expect(accepted.status).toBe('packing');
    expect(accepted.lines[0]).toMatchObject({ status: 'picked', packedGrams: 2500 });
    expect((await p.finish()).status).toBe(200);
  });

  it('declining asks for a repack; the packer weighs again', async () => {
    const p = await packing((s) => [{ itemId: s.kg.id, grams: 2000 }]);
    const line = p.order.lines[0]!.id;
    await p.weigh(line, 1500);
    const declined = cust(await p.decide(line, 'decline'));
    expect(declined.lines[0]).toMatchObject({ status: 'pending', proposedGrams: null });
    expect(staff(await p.weigh(line, 1950)).lines[0]!.status).toBe('picked');
  });

  it('a mix box is weighed (no stock), and weighed items cannot be scanned per unit', async () => {
    const p = await packing((s) => [
      { itemId: s.mix.id, grams: 1000, mixItemIds: [s.items[0]!.id, s.items[2]!.id] },
    ]);
    const line = p.order.lines[0]!.id;
    expect(
      errorCode(
        await call(shopScanHandler, {
          method: 'POST',
          session: p.s.packer.session,
          ...p.id,
          body: { barcode: 'BCKG-1' },
        }),
      ),
    ).toBe('weigh_required');
    expect(staff(await p.weigh(line, 1040)).lines[0]).toMatchObject({
      status: 'picked',
      packedGrams: 1040,
    });
    const [it3] = await getDb().select().from(items).where(eq(items.id, p.s.items[2]!.id));
    expect(it3!.stockQty).toBe(1); // mix contents are not taken from per-item stock
  });

  it('pack lines cannot be weighed', async () => {
    const p = await packing((s) => [{ itemId: s.items[0]!.id, qty: 1 }]);
    expect(errorCode(await p.weigh(p.order.lines[0]!.id, 500))).toBe('not_weighed');
  });
});
