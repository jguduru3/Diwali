import { describe, expect, it } from 'vitest';
import { healthResponseSchema } from './schemas';
import { itemsResponseSchema } from './domain';

describe('healthResponseSchema', () => {
  it('accepts the health payload', () => {
    expect(healthResponseSchema.parse({ ok: true, db: true, config: true })).toEqual({
      ok: true,
      db: true,
      config: true,
    });
  });

  it('rejects extra keys', () => {
    expect(() =>
      healthResponseSchema.parse({ ok: true, db: true, config: true, extra: 1 }),
    ).toThrow();
  });
});

describe('price list saved in the offline cache before a release', () => {
  it('still parses, with defaults for fields added since', () => {
    // An item and category as the API sent them before Hindi names, tags and kilo sales.
    const old = {
      shopCode: 'SLC01',
      priceVersion: 1,
      categories: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          slug: 'sparklers',
          nameEn: 'Sparklers',
          nameTe: null,
          sort: 10,
          isBanned: false,
          bannedReason: null,
        },
      ],
      items: [
        {
          id: '22222222-2222-4222-8222-222222222222',
          itemNo: 1,
          categoryId: '11111111-1111-4111-8111-111111111111',
          nameEn: 'Sparkler',
          nameTe: null,
          packDesc: '10 pcs',
          pricePaise: 5000,
          priceVersion: 1,
          greenCert: 'CSIR_NEERI_SWAS',
          greenRef: 'REF-1',
          rackCode: null,
          imageUrl: null,
          barcode: null,
          stockQty: null,
          offerPricePaise: null,
          offerEndsAt: null,
          effectivePricePaise: 5000,
          isSoldOut: false,
          isActive: true,
        },
      ],
    };
    const parsed = itemsResponseSchema.parse(old);
    expect(parsed.categories[0]!.nameHi).toBeNull();
    expect(parsed.items[0]).toMatchObject({
      nameHi: null,
      isRecommended: false,
      isPopular: false,
      isStandard: false,
      weightGrams: null,
    });
  });
});
