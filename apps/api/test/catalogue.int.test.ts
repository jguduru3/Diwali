import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { itemsResponseSchema, shopSummarySchema, type Item } from '@pataka/shared';
import { getDb } from '../src/db/client';
import { items, shopLicences, shops } from '../src/db/schema';
import { licenceVerifyHandler } from '../src/functions/console';
import { shopItemsHandler, shopsHandler } from '../src/functions/public';
import {
  shopItemCreateHandler,
  shopItemPatchHandler,
  shopItemSoldOutHandler,
  shopLicenceSubmitHandler,
} from '../src/functions/shop';
import { expireLicences } from '../src/lib/jobs';
import { body, call, errorCode, makeListedShop, makeShop, makeUser } from './helpers';

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
  it('serves active items with an ETag of the price version and honours If-None-Match', async () => {
    await makeListedShop();
    const res = await call(shopItemsHandler, { params: { code: 'slc01' } });
    const parsed = itemsResponseSchema.parse(res.jsonBody);
    expect(parsed.items).toHaveLength(4);
    expect(res.headers).toMatchObject({ ETag: '"v1"' });
    const again = await call(shopItemsHandler, {
      params: { code: 'SLC01' },
      headers: { 'if-none-match': '"v1"' },
    });
    expect(again.status).toBe(304);
  });

  it('owners add items; the item number is assigned and the price version bumps', async () => {
    const { owner, allowedCategory } = await makeListedShop();
    const res = await call(shopItemCreateHandler, {
      method: 'POST',
      session: owner.session,
      body: {
        categoryId: allowedCategory.id,
        nameEn: 'Gold Fountain',
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
  });

  it('G7: items cannot go into a banned category (API and database)', async () => {
    const { owner, bannedCategory, shop } = await makeListedShop();
    const res = await call(shopItemCreateHandler, {
      method: 'POST',
      session: owner.session,
      body: {
        categoryId: bannedCategory.id,
        nameEn: '1000 wala',
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
