import { describe, expect, it } from 'vitest';
import {
  ean13CheckDigit,
  ean13Modules,
  generateStoreBarcode,
  isValidEan13,
  kiloUnitPaise,
  resolvePricing,
} from './catalogue';

describe('resolvePricing — MRP (normal / pack) sale', () => {
  it('keeps the price and offer as entered and clears every kilo field', () => {
    expect(
      resolvePricing({
        saleMode: 'mrp',
        pricePaise: 25000,
        offerPricePaise: 20000,
        pricePerKgPaise: 99,
        weightGrams: 500,
      }),
    ).toEqual({
      ok: true,
      value: {
        saleMode: 'mrp',
        pricePaise: 25000,
        offerPricePaise: 20000,
        pricePerKgPaise: null,
        offerPricePerKgPaise: null,
        weightGrams: null,
      },
    });
  });

  it('needs a price', () => {
    expect(resolvePricing({ saleMode: 'mrp' })).toMatchObject({
      ok: false,
      code: 'price_required',
    });
  });

  it('refuses an offer that is not lower than the price', () => {
    expect(
      resolvePricing({ saleMode: 'mrp', pricePaise: 10000, offerPricePaise: 10000 }),
    ).toMatchObject({ ok: false, code: 'offer_not_lower' });
  });
});

describe('resolvePricing — kilo sale', () => {
  it('prices one pack from the rate per kg and the pack weight', () => {
    expect(
      resolvePricing({
        saleMode: 'kilo',
        pricePerKgPaise: 52000,
        offerPricePerKgPaise: 48000,
        weightGrams: 500,
        pricePaise: 1, // ignored: the server derives the pack price
      }),
    ).toEqual({
      ok: true,
      value: {
        saleMode: 'kilo',
        pricePaise: 26000,
        offerPricePaise: 24000,
        pricePerKgPaise: 52000,
        offerPricePerKgPaise: 48000,
        weightGrams: 500,
      },
    });
  });

  it('needs the weight and the rate per kg', () => {
    expect(resolvePricing({ saleMode: 'kilo', pricePerKgPaise: 50000 })).toMatchObject({
      ok: false,
      code: 'weight_required',
    });
    expect(resolvePricing({ saleMode: 'kilo', weightGrams: 250 })).toMatchObject({
      ok: false,
      code: 'price_required',
    });
  });

  it('refuses an offer rate that is not lower, also after rounding to a pack', () => {
    expect(
      resolvePricing({
        saleMode: 'kilo',
        pricePerKgPaise: 50000,
        offerPricePerKgPaise: 50000,
        weightGrams: 1000,
      }),
    ).toMatchObject({ ok: false, code: 'offer_not_lower' });
    // 1 g packs: ₹1.01/kg and ₹1.00/kg both round to 0 paise a pack
    expect(
      resolvePricing({
        saleMode: 'kilo',
        pricePerKgPaise: 1_000_000,
        offerPricePerKgPaise: 999_999,
        weightGrams: 1,
      }),
    ).toMatchObject({ ok: false, code: 'offer_not_lower' });
  });

  it('refuses a pack that would cost less than one paisa', () => {
    expect(
      resolvePricing({ saleMode: 'kilo', pricePerKgPaise: 100, weightGrams: 1 }),
    ).toMatchObject({ ok: false, code: 'price_too_low' });
  });

  it('rounds half a paisa up', () => {
    expect(kiloUnitPaise(1001, 500)).toBe(501);
    expect(kiloUnitPaise(52000, 250)).toBe(13000);
  });
});

describe('store barcodes (EAN-13, in-store prefix 20)', () => {
  it('computes the GS1 check digit', () => {
    expect(ean13CheckDigit('400638133393')).toBe(1);
    expect(ean13CheckDigit('590123412345')).toBe(7);
    expect(isValidEan13('4006381333931')).toBe(true);
    expect(isValidEan13('4006381333932')).toBe(false);
    expect(isValidEan13('400638133393')).toBe(false);
  });

  it('generates valid, in-store codes from the random source', () => {
    const fixed = generateStoreBarcode(() => 0.123456789);
    expect(fixed).toMatch(/^20\d{11}$/);
    expect(isValidEan13(fixed)).toBe(true);
    const many = new Set(Array.from({ length: 500 }, () => generateStoreBarcode()));
    expect(many.size).toBe(500);
    for (const c of many) expect(isValidEan13(c)).toBe(true);
  });

  it('encodes 95 modules with guard bars', () => {
    const m = ean13Modules('4006381333931');
    expect(m).toHaveLength(95);
    expect(m.slice(0, 3)).toBe('101');
    expect(m.slice(45, 50)).toBe('01010');
    expect(m.slice(92)).toBe('101');
    // first digit 4 → parity LGLLGG; second digit 0 in L code is 0001101
    expect(m.slice(3, 10)).toBe('0001101');
    // last digit 1 in R code is 1100110
    expect(m.slice(85, 92)).toBe('1100110');
    expect(() => ean13Modules('123')).toThrow();
  });
});
