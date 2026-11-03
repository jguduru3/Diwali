import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { isValidEan13, itemsResponseSchema, shopSummarySchema, type Item } from '@pataka/shared';
import { getDb } from '../src/db/client';
import { auditLog, items, orders, shopLicences, shops } from '../src/db/schema';
import { licenceVerifyHandler } from '../src/functions/console';
import { shopItemsHandler, shopsHandler } from '../src/functions/public';
import {
  shopItemCreateHandler,
  shopItemPatchHandler,
  shopItemRemoveHandler,
  shopItemSoldOutHandler,
  shopItemsListHandler,
  shopLicenceSubmitHandler,
} from '../src/functions/shop';
import { expireLicences } from '../src/lib/jobs';
import { body, call, errorCode, makeListedShop, makeShop, makeUser } from './helpers';
import { placed } from './orderHelpers';

const listedCodes = async () =>
  (body<{ shortCode: string }[]>(await call(shopsHandler)) ?? []).map((s) => s.shortCode);

describe('G6 — only verified, in-date licensed shops are visible', () => {
  it('lists a live shop with a verified licence and its licence badge', async () => {
    await makeListedShop('SLC01');
    const res = await call(shopsHandler);
    const [shop] = shopSummarySchema.array().parse(res.jsonBody);
    expect(shop).toMatchObject({ shortCode: 'SLC01', licence: { licenceNo: 'LE5/SLC01' } });
  });

  it('hides shops that are not live, unlicensed, pending or expired', async () => {
    const { shop } = await makeListedShop('SLC01');
    await makeShop('NOLIC'); // no licence at all
    expect(await listedCodes()).toEqual(['SLC01']);

    await getDb().update(shops).set({ isLive: false }).where(eq(shops.id, shop.id));
    expect(await listedCodes()).toEqual([]);

    await getDb().update(shops).set({ isLive: true }).where(eq(shops.id, shop.id));
    await getDb()
      .update(shopLicences)
      .set({ validTo: '2025-01-01' })
      .where(eq(shopLicences.shopId, shop.id));
    expect(await expireLicences(getDb())).toBe(1);
    expect(await listedCodes()).toEqual([]);
    expect((await call(shopItemsHandler, { params: { code: 'SLC01' } })).status).toBe(404);
  });

  it('a new shop is invisible until its licence is verified, then appears', async () => {
    const admin = await makeUser('admin');
    const { shop } = await makeShop('NEW01');
    const [lic] = await getDb()
      .insert(shopLicences)
      .values({
        shopId: shop.id,
        licenceNo: 'TMP/1',
        licenceType: 'Temporary',
        validFrom: '2020-01-01',
        validTo: '2099-01-01',
        imageBlobPath: 'x.png',
      })
      .returning();
    expect(await listedCodes()).toEqual([]);
    const res = await call(licenceVerifyHandler, {
      method: 'POST',
      session: admin.session,
      params: { id: lic!.id },
      body: {},
    });
    expect(res.status).toBe(200);
    expect(await listedCodes()).toEqual(['NEW01']);
  });
});

describe('price list', () => {
  it('serves active items with a content ETag and honours If-None-Match', async () => {
    const shop = await makeListedShop();
    const res = await call(shopItemsHandler, { params: { code: 'slc01' } });
    const parsed = itemsResponseSchema.parse(res.jsonBody);
    expect(parsed.items).toHaveLength(4);
    const etag = (res.headers as Record<string, string>).ETag!;
    expect(etag).toMatch(/^"v1-[\w-]+"$/);
    const again = await call(shopItemsHandler, {
      params: { code: 'SLC01' },
      headers: { 'if-none-match': etag },
    });
    expect(again.status).toBe(304);

    // A copy cached under the old price-version-only tag is never told it is still current.
    const legacy = await call(shopItemsHandler, {
      params: { code: 'SLC01' },
      headers: { 'if-none-match': '"v1"' },
    });
    expect(legacy.status).toBe(200);

    // Stock changes don't bump the price version, but they do change the tag.
    await getDb().update(items).set({ stockQty: 7 }).where(eq(items.id, shop.items[0]!.id));
    const afterStock = await call(shopItemsHandler, {
      params: { code: 'SLC01' },
      headers: { 'if-none-match': etag },
    });
    expect(afterStock.status).toBe(200);
    expect((afterStock.headers as Record<string, string>).ETag).not.toBe(etag);
  });

  it('owners add items; the item number is assigned and the price version bumps', async () => {
    const { owner, allowedCategory } = await makeListedShop();
    const res = await call(shopItemCreateHandler, {
      method: 'POST',
      session: owner.session,
      body: {
        categoryId: allowedCategory.id,
        nameEn: 'Gold Fountain',
        saleMode: 'mrp',
        pricePaise: 22000,
        greenCert: 'CSIR_NEERI_STAR',
        greenRef: 'NEERI-STAR-1',
      },
    });
    expect(res.status).toBe(201);
    expect(body<Item>(res).itemNo).toBe(5);
    const list = itemsResponseSchema.parse(
      (await call(shopItemsHandler, { params: { code: 'SLC01' } })).jsonBody,
    );
    expect(list.priceVersion).toBe(2);
    expect(list.items.find((i) => i.itemNo === 5)).toMatchObject({
      isRecommended: false,
      isPopular: false,
      weightGrams: null,
    });
  });

  it('owners set the listing tags and a kilo sale; the server prices the pack from the rate per kg', async () => {
    const { owner, allowedCategory } = await makeListedShop();
    const res = await call(shopItemCreateHandler, {
      method: 'POST',
      session: owner.session,
      body: {
        categoryId: allowedCategory.id,
        nameEn: 'Green Sparklers',
        packDesc: 'loose',
        saleMode: 'kilo',
        pricePerKgPaise: 52000,
        offerPricePerKgPaise: 48000,
        pricePaise: 1, // ignored for kilo sales (G11)
        weightGrams: 500,
        greenCert: 'CSIR_NEERI_STAR',
        greenRef: 'NEERI-STAR-2',
        isRecommended: true,
        isPopular: true,
      },
    });
    expect(res.status).toBe(201);
    const list = itemsResponseSchema.parse(
      (await call(shopItemsHandler, { params: { code: 'SLC01' } })).jsonBody,
    );
    expect(list.items.find((i) => i.id === body<Item>(res).id)).toMatchObject({
      isRecommended: true,
      isPopular: true,
      saleMode: 'kilo',
      weightGrams: 500,
      packDesc: 'loose',
      pricePerKgPaise: 52000,
      offerPricePerKgPaise: 48000,
      pricePaise: 26000,
      offerPricePaise: 24000,
      effectivePricePaise: 24000,
    });

    const bad = await call(shopItemCreateHandler, {
      method: 'POST',
      session: owner.session,
      body: {
        categoryId: allowedCategory.id,
        nameEn: 'Bad weight',
        saleMode: 'kilo',
        pricePerKgPaise: 1000,
        greenCert: 'CSIR_NEERI_STAR',
        greenRef: 'NEERI-STAR-3',
        weightGrams: 0,
      },
    });
    expect(bad.status).toBe(400);
  });

  it('the sale mode is required and its price fields must be present', async () => {
    const { owner, allowedCategory } = await makeListedShop();
    const base = {
      categoryId: allowedCategory.id,
      nameEn: 'Flower Pots',
      greenCert: 'CSIR_NEERI_STAR',
      greenRef: 'NEERI-STAR-4',
    };
    const create = (extra: object) =>
      call(shopItemCreateHandler, {
        method: 'POST',
        session: owner.session,
        body: { ...base, ...extra },
      });
    expect((await create({ pricePaise: 1000 })).status).toBe(400); // no mode
    expect((await create({ saleMode: null, pricePaise: 1000 })).status).toBe(400);
    expect((await create({ saleMode: 'kilo', pricePaise: 1000, weightGrams: 500 })).status).toBe(
      400,
    ); // kilo needs the rate per kg
    expect((await create({ saleMode: 'mrp', weightGrams: 500 })).status).toBe(400);
    expect(
      (await create({ saleMode: 'mrp', pricePaise: 1000, offerPricePaise: 1000 })).status,
    ).toBe(400);
  });

  it('switching a product between MRP and kilo sale re-derives its prices', async () => {
    const { owner, items: rows } = await makeListedShop();
    const id = rows[0]!.id;
    const toKilo = await call(shopItemPatchHandler, {
      method: 'PATCH',
      session: owner.session,
      params: { id },
      body: { saleMode: 'kilo', pricePerKgPaise: 40000, weightGrams: 250 },
    });
    expect(toKilo.status).toBe(200);
    expect(body<Item>(toKilo)).toMatchObject({
      saleMode: 'kilo',
      pricePaise: 10000,
      weightGrams: 250,
      offerPricePaise: null,
    });
    // a new weight alone re-prices the pack from the stored rate
    const heavier = await call(shopItemPatchHandler, {
      method: 'PATCH',
      session: owner.session,
      params: { id },
      body: { weightGrams: 1000 },
    });
    expect(body<Item>(heavier)).toMatchObject({ pricePaise: 40000, pricePerKgPaise: 40000 });
    const back = await call(shopItemPatchHandler, {
      method: 'PATCH',
      session: owner.session,
      params: { id },
      body: { saleMode: 'mrp', pricePaise: 15000 },
    });
    expect(body<Item>(back)).toMatchObject({
      saleMode: 'mrp',
      pricePaise: 15000,
      weightGrams: null,
      pricePerKgPaise: null,
    });
    // the database refuses a kilo row without a rate, whatever the caller
    await expect(
      getDb().update(items).set({ saleMode: 'kilo' }).where(eq(items.id, id)),
    ).rejects.toBeTruthy();
  });

  it('new products get a unique in-store EAN-13 barcode; a box barcode is kept', async () => {
    const { owner, allowedCategory } = await makeListedShop();
    const make = (nameEn: string, extra: object = {}) =>
      call(shopItemCreateHandler, {
        method: 'POST',
        session: owner.session,
        body: {
          categoryId: allowedCategory.id,
          nameEn,
          saleMode: 'mrp',
          pricePaise: 5000,
          greenCert: 'CSIR_NEERI_SWAS',
          greenRef: 'NEERI-SWAS-9',
          ...extra,
        },
      });
    const codes = new Set<string>();
    for (const n of ['A1', 'A2', 'A3', 'A4', 'A5']) {
      const item = body<Item>(await make(n));
      expect(item.barcode).toMatch(/^20\d{11}$/);
      expect(isValidEan13(item.barcode!)).toBe(true);
      codes.add(item.barcode!);
    }
    expect(codes.size).toBe(5);
    const [stored] = await getDb()
      .select({ source: items.barcodeSource })
      .from(items)
      .where(eq(items.barcode, [...codes][0]!));
    expect(stored!.source).toBe('store');

    const boxed = body<Item>(await make('Boxed', { barcode: '8901234567890' }));
    expect(boxed.barcode).toBe('8901234567890');
    const clash = await make('Clash', { barcode: '8901234567890' });
    expect(errorCode(clash)).toBe('barcode_taken');

    // clearing the barcode asks for a new store barcode
    const regen = await call(shopItemPatchHandler, {
      method: 'PATCH',
      session: owner.session,
      params: { id: boxed.id },
      body: { barcode: null },
    });
    expect(body<Item>(regen).barcode).toMatch(/^20\d{11}$/);
  });

  it('stores and serves Telugu and Hindi item names; both are optional', async () => {
    const { owner, allowedCategory } = await makeListedShop();
    const res = await call(shopItemCreateHandler, {
      method: 'POST',
      session: owner.session,
      body: {
        categoryId: allowedCategory.id,
        nameEn: 'Gold Fountain',
        nameTe: 'గోల్డ్ ఫౌంటెన్',
        nameHi: 'गोल्ड फव्वारा',
        saleMode: 'mrp',
        pricePaise: 22000,
        greenCert: 'CSIR_NEERI_STAR',
        greenRef: 'NEERI-STAR-1',
      },
    });
    expect(res.status).toBe(201);
    expect(body<Item>(res)).toMatchObject({ nameTe: 'గోల్డ్ ఫౌంటెన్', nameHi: 'गोल्ड फव्वारा' });
    const list = itemsResponseSchema.parse(
      (await call(shopItemsHandler, { params: { code: 'SLC01' } })).jsonBody,
    );
    expect(list.items.find((i) => i.nameEn === 'Gold Fountain')?.nameHi).toBe('गोल्ड फव्वारा');
    expect(list.items.find((i) => i.nameEn !== 'Gold Fountain')?.nameHi).toBeNull();
  });

  it('G7: items cannot go into a banned category (API and database)', async () => {
    const { owner, bannedCategory, shop } = await makeListedShop();
    const res = await call(shopItemCreateHandler, {
      method: 'POST',
      session: owner.session,
      body: {
        categoryId: bannedCategory.id,
        nameEn: '1000 wala',
        saleMode: 'mrp',
        pricePaise: 50000,
        greenCert: 'CSIR_NEERI_SWAS',
        greenRef: 'X-1',
      },
    });
    expect(res.status).toBe(422);
    expect(errorCode(res)).toBe('category_banned');

    await expect(
      getDb().insert(items).values({
        shopId: shop.id,
        itemNo: 99,
        categoryId: bannedCategory.id,
        nameEn: 'sneaky',
        pricePaise: 100,
        greenCert: 'CSIR_NEERI_SWAS',
        greenRef: 'X-2',
      }),
    ).rejects.toMatchObject({ cause: { message: expect.stringMatching(/banned/) } });
  });

  it('G7: every item needs a green certificate reference', async () => {
    const { owner, allowedCategory } = await makeListedShop();
    const res = await call(shopItemCreateHandler, {
      method: 'POST',
      session: owner.session,
      body: {
        categoryId: allowedCategory.id,
        nameEn: 'No cert',
        saleMode: 'mrp',
        pricePaise: 1000,
        greenCert: 'CSIR_NEERI_SWAS',
        greenRef: '',
      },
    });
    expect(res.status).toBe(400);
  });

  it('counter staff can toggle sold-out but not change prices; other shops get 403', async () => {
    const { staff, items: rows } = await makeListedShop();
    const other = await makeListedShop('BAL01');
    const id = rows[0]!.id;
    const sold = await call(shopItemSoldOutHandler, {
      method: 'PATCH',
      session: staff.session,
      params: { id },
      body: { isSoldOut: true },
    });
    expect(body<Item>(sold).isSoldOut).toBe(true);
    const price = await call(shopItemPatchHandler, {
      method: 'PATCH',
      session: staff.session,
      params: { id },
      body: { pricePaise: 1 },
    });
    expect(errorCode(price)).toBe('owner_only');
    const foreign = await call(shopItemSoldOutHandler, {
      method: 'PATCH',
      session: other.owner.session,
      params: { id },
      body: { isSoldOut: false },
    });
    expect(foreign.status).toBe(404); // scoped to the caller's own shop
  });
});

describe('remove product', () => {
  const ownList = async (session: string) =>
    body<{ items: Item[] }>(await call(shopItemsListHandler, { session })).items;

  it('owner removes a product: gone from every list, barcode freed, audited, price version bumps', async () => {
    const shop = await makeListedShop();
    const id = shop.items[0]!.id;
    await getDb().update(items).set({ barcode: '8910001' }).where(eq(items.id, id));

    const res = await call(shopItemRemoveHandler, {
      method: 'DELETE',
      session: shop.owner.session,
      params: { id },
    });
    expect(res.status).toBe(204);

    expect((await ownList(shop.owner.session)).map((i) => i.id)).not.toContain(id);
    const pub = itemsResponseSchema.parse(
      (await call(shopItemsHandler, { params: { code: 'SLC01' } })).jsonBody,
    );
    expect(pub.items.map((i) => i.id)).not.toContain(id);
    expect(pub.priceVersion).toBe(2);

    const [row] = await getDb().select().from(items).where(eq(items.id, id));
    expect(row).toMatchObject({ isActive: false, barcode: null });
    expect(row!.removedAt).toBeInstanceOf(Date);
    const [log] = await getDb().select().from(auditLog).where(eq(auditLog.entityId, id));
    expect(log).toMatchObject({ action: 'item.remove', meta: { barcode: '8910001' } });

    // a removed product cannot be edited, shown again or removed twice
    const patch = await call(shopItemPatchHandler, {
      method: 'PATCH',
      session: shop.owner.session,
      params: { id },
      body: { isActive: true },
    });
    expect(patch.status).toBe(404);
    const again = await call(shopItemRemoveHandler, {
      method: 'DELETE',
      session: shop.owner.session,
      params: { id },
    });
    expect(again.status).toBe(404);
  });

  it('only the owner of this shop can remove', async () => {
    const shop = await makeListedShop();
    const other = await makeListedShop('BAL01');
    const id = shop.items[0]!.id;
    const byStaff = await call(shopItemRemoveHandler, {
      method: 'DELETE',
      session: shop.staff.session,
      params: { id },
    });
    expect(byStaff.status).toBe(403);
    const byOther = await call(shopItemRemoveHandler, {
      method: 'DELETE',
      session: other.owner.session,
      params: { id },
    });
    expect(byOther.status).toBe(404);
    expect((await ownList(shop.owner.session)).map((i) => i.id)).toContain(id);
  });

  it('is refused while an open order needs the product; allowed once the order is final', async () => {
    const shop = await makeListedShop();
    const { order } = await placed(shop, [[0, 1]]);
    const id = shop.items[0]!.id;
    const refused = await call(shopItemRemoveHandler, {
      method: 'DELETE',
      session: shop.owner.session,
      params: { id },
    });
    expect(refused.status).toBe(409);
    expect(errorCode(refused)).toBe('item_in_open_orders');

    await getDb().update(orders).set({ status: 'cancelled' }).where(eq(orders.id, order.id));
    const ok = await call(shopItemRemoveHandler, {
      method: 'DELETE',
      session: shop.owner.session,
      params: { id },
    });
    expect(ok.status).toBe(204);
  });
});

describe('licence upload', () => {
  it('stores the photo and creates a pending licence; rejects non-images', async () => {
    const { owner } = await makeListedShop();
    const png =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=='.repeat(
        2,
      );
    const ok = await call(shopLicenceSubmitHandler, {
      method: 'POST',
      session: owner.session,
      body: {
        licenceNo: 'LE5/NEW/1',
        licenceType: 'LE-5',
        validFrom: '2026-10-01',
        validTo: '2026-11-30',
        image: { contentType: 'image/png', base64: png },
      },
    });
    expect(ok.status).toBe(201);
    expect(body<{ status: string }>(ok).status).toBe('pending');

    const bad = await call(shopLicenceSubmitHandler, {
      method: 'POST',
      session: owner.session,
      body: {
        licenceNo: 'LE5/NEW/2',
        licenceType: 'LE-5',
        validFrom: '2026-10-01',
        validTo: '2026-11-30',
        image: {
          contentType: 'image/png',
          base64: Buffer.from('<svg>'.repeat(40)).toString('base64'),
        },
      },
    });
    expect(errorCode(bad)).toBe('bad_image');
  });
});
